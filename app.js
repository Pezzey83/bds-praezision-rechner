(function () {
  "use strict";

  var STORAGE_KEY = "bds-praezision-sessions";
  var SCHUSS_GESAMT = 20;
  var MAIN_KEYS = ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "fehler"];
  var POINT_VALUES = { "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2, "1": 1, "fehler": 0 };
  var ZEIT_WARN_SEKUNDEN = 600; // 10 Minuten

  var VISIERUNG_DEFAULT = "Optisch";

  var state = {
    waffenart: null,
    visierung: VISIERUNG_DEFAULT,
    kaliber: null,
    kaliberDetail: null
  };

  var wasClamped = false;
  var clampOverage = 0;
  var mWasClamped = false;

  var els = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    els.schuetze = $("schuetze");
    els.schuetzenListe = $("schuetzen-liste");

    els.zeit = $("zeit");
    els.zeitHint = $("zeit-hint");

    els.mainInputs = MAIN_KEYS.map(function (k) { return $("treffer-" + k); });
    els.treffer10 = $("treffer-10");
    els.trefferM = $("treffer-m");
    els.mHint = $("m-hint");
    els.shotHint = $("shot-hint");

    els.resM = $("res-m");
    els.resZeit = $("res-zeit");
    els.resEndergebnis = $("res-endergebnis");

    els.form = $("session-form");
    els.btnReset = $("btn-reset");
    els.tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    els.views = Array.prototype.slice.call(document.querySelectorAll(".view"));
    els.filterSchuetze = $("filter-schuetze");
    els.filterSportgeraet = $("filter-sportgeraet");
    els.filterKaliberDetail = $("filter-kaliber-detail");
    els.kaliberDetailField = $("kaliber-detail-field");
    els.verlaufListe = $("verlauf-liste");
    els.modal = $("detail-modal");
    els.modalContent = $("detail-content");
    els.modalClose = $("modal-close");
    els.modalDelete = $("modal-delete");
    els.btnExport = $("btn-export");
    els.btnImport = $("btn-import");
    els.importFile = $("import-file");
    els.syncHint = $("sync-hint");

    document.querySelectorAll(".btn-group").forEach(function (group) {
      group.addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        if (!btn) return;
        var groupName = group.getAttribute("data-group");
        Array.prototype.forEach.call(group.children, function (b) {
          b.classList.remove("selected");
        });
        btn.classList.add("selected");
        state[groupName] = btn.getAttribute("data-value");
        if (groupName === "kaliber") updateKaliberDetailVisibility(state.kaliber);
      });
    });

    els.mainInputs.forEach(function (inp) {
      inp.addEventListener("input", function () {
        clampMainInput(inp);
        if (inp === els.treffer10) clampM();
        calculate();
      });
    });

    els.trefferM.addEventListener("input", function () {
      clampM();
      calculate();
    });

    els.zeit.addEventListener("input", function () {
      formatZeitInput(els.zeit);
      updateZeitHint();
      calculate();
    });

    els.tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.getAttribute("data-tab");
        els.tabs.forEach(function (t) { t.classList.toggle("active", t === tab); });
        els.views.forEach(function (v) {
          v.classList.toggle("active", v.id === "view-" + target);
        });
        if (target === "verlauf") renderVerlauf();
      });
    });

    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      saveSession();
    });

    els.btnReset.addEventListener("click", resetForm);

    els.filterSchuetze.addEventListener("input", renderVerlauf);
    els.filterSportgeraet.addEventListener("change", renderVerlauf);
    els.filterKaliberDetail.addEventListener("change", renderVerlauf);

    els.modalClose.addEventListener("click", closeModal);
    els.modal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    els.modalDelete.addEventListener("click", function () {
      if (!currentModalId) return;
      if (!confirm("Diesen Eintrag wirklich löschen?")) return;
      var sessions = loadSessions().filter(function (s) { return s.id !== currentModalId; });
      saveSessions(sessions);
      closeModal();
      updateSchuetzenListe();
      renderVerlauf();
    });

    els.btnExport.addEventListener("click", exportSessions);
    els.btnImport.addEventListener("click", function () { els.importFile.click(); });
    els.importFile.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (file) importSessions(file);
      els.importFile.value = "";
    });

    updateSchuetzenListe();
    calculate();
  }

  function updateKaliberDetailVisibility(kaliberValue) {
    if (kaliberValue === "Großkaliber") {
      els.kaliberDetailField.hidden = false;
    } else {
      els.kaliberDetailField.hidden = true;
      state.kaliberDetail = null;
      els.kaliberDetailField.querySelectorAll("button.selected").forEach(function (b) {
        b.classList.remove("selected");
      });
    }
  }

  function clampMainInput(changedInput) {
    var raw = parseInt(changedInput.value, 10);
    if (isNaN(raw) || raw < 0) {
      if (changedInput.value !== "") changedInput.value = 0;
      raw = 0;
    }

    var others = els.mainInputs
      .filter(function (inp) { return inp !== changedInput; })
      .reduce(function (sum, inp) { return sum + (parseInt(inp.value, 10) || 0); }, 0);

    var max = SCHUSS_GESAMT - others;
    if (max < 0) max = 0;
    if (raw > max) {
      clampOverage = raw - max;
      changedInput.value = max;
      wasClamped = true;
    }
  }

  function clampM() {
    var raw = parseInt(els.trefferM.value, 10);
    if (isNaN(raw) || raw < 0) {
      if (els.trefferM.value !== "") els.trefferM.value = 0;
      raw = 0;
    }
    var maxM = parseInt(els.treffer10.value, 10) || 0;
    if (raw > maxM) {
      els.trefferM.value = maxM;
      mWasClamped = true;
    }
  }

  function formatZeitInput(inputEl) {
    var digits = inputEl.value.replace(/\D/g, "").slice(0, 4);
    var formatted;
    if (digits.length <= 2) {
      formatted = digits;
    } else {
      var sekTeil = digits.slice(-2);
      var minTeil = digits.slice(0, -2);
      formatted = minTeil + ":" + sekTeil;
    }
    inputEl.value = formatted;
  }

  function parseZeit(str) {
    var trimmed = (str || "").trim();
    if (trimmed === "") return { empty: true, valid: true };
    var m = trimmed.match(/^(\d{1,3}):([0-5][0-9])$/);
    if (!m) return { empty: false, valid: false };
    var minuten = parseInt(m[1], 10);
    var sekunden = parseInt(m[2], 10);
    return {
      empty: false,
      valid: true,
      totalSekunden: minuten * 60 + sekunden,
      label: minuten + ":" + String(sekunden).padStart(2, "0")
    };
  }

  function updateZeitHint() {
    var parsed = parseZeit(els.zeit.value);
    if (parsed.empty) {
      els.zeitHint.hidden = true;
      return;
    }
    if (!parsed.valid) {
      if (els.zeit.value.indexOf(":") === -1) {
        els.zeitHint.hidden = true;
        return;
      }
      els.zeitHint.textContent = "Format MM:SS erwartet (z. B. 8:23).";
      els.zeitHint.hidden = false;
      return;
    }
    if (parsed.totalSekunden > ZEIT_WARN_SEKUNDEN) {
      els.zeitHint.textContent = "Zeit über 10:00 — bitte prüfen.";
      els.zeitHint.hidden = false;
      return;
    }
    els.zeitHint.hidden = true;
  }

  function calculate() {
    var counts = {};
    var erfasst = 0;
    var endergebnis = 0;
    MAIN_KEYS.forEach(function (k) {
      var v = parseInt($("treffer-" + k).value, 10) || 0;
      counts[k] = v;
      erfasst += v;
      endergebnis += v * POINT_VALUES[k];
    });

    var m = parseInt(els.trefferM.value, 10) || 0;

    var zeitParsed = parseZeit(els.zeit.value);
    var zeitLabel = (!zeitParsed.empty && zeitParsed.valid) ? zeitParsed.label : null;

    els.resM.textContent = m;
    els.resZeit.textContent = zeitLabel || "–";
    els.resEndergebnis.textContent = endergebnis;

    var hinweis = erfasst + " / " + SCHUSS_GESAMT + " Schuss erfasst";
    if (wasClamped) {
      hinweis += (clampOverage > SCHUSS_GESAMT)
        ? " — zu viele Treffer, Feld automatisch verringert."
        : " — " + clampOverage + " Treffer zu viel erfasst, Feld automatisch verringert.";
    } else if (erfasst < SCHUSS_GESAMT) {
      hinweis += " — Achtung: weniger als 20 Treffer dokumentiert.";
    }
    els.shotHint.textContent = hinweis;
    els.shotHint.classList.toggle("warn", erfasst !== SCHUSS_GESAMT && !wasClamped);
    els.shotHint.classList.toggle("clamp-alert", wasClamped);
    els.shotHint.classList.remove("clamp-flash");
    if (wasClamped) {
      void els.shotHint.offsetWidth;
      els.shotHint.classList.add("clamp-flash");
    }
    wasClamped = false;

    els.mHint.hidden = !mWasClamped;
    mWasClamped = false;

    return {
      counts: counts,
      m: m,
      erfasst: erfasst,
      endergebnis: endergebnis,
      zeitLabel: zeitLabel,
      zeitSekunden: (zeitLabel !== null) ? zeitParsed.totalSekunden : null,
      zeitWarnung: (zeitLabel !== null) ? (zeitParsed.totalSekunden > ZEIT_WARN_SEKUNDEN) : false
    };
  }

  function loadSessions() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  function updateSchuetzenListe() {
    var sessions = loadSessions();
    var names = Array.from(new Set(sessions.map(function (s) { return s.schuetze; }))).sort();
    els.schuetzenListe.innerHTML = names.map(function (n) {
      return '<option value="' + escapeHtml(n) + '">';
    }).join("");
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function saveSession() {
    var name = els.schuetze.value.trim();
    if (!name) {
      els.schuetze.focus();
      return;
    }
    if (!state.waffenart) {
      alert("Bitte Waffenart auswählen.");
      return;
    }
    if (!state.kaliber) {
      alert("Bitte Kaliber auswählen.");
      return;
    }
    if (state.kaliber === "Großkaliber" && !state.kaliberDetail) {
      alert("Bitte konkretes Kaliber auswählen (9mm / .44 Spec / .45 ACP).");
      return;
    }

    var zeitParsed = parseZeit(els.zeit.value);
    if (!zeitParsed.empty && !zeitParsed.valid) {
      alert("Zeit-Format ungültig. Bitte MM:SS verwenden (z. B. 8:23) oder leer lassen.");
      els.zeit.focus();
      return;
    }

    var result = calculate();
    var now = new Date();

    var session = {
      id: "p" + now.getTime() + Math.random().toString(36).slice(2, 7),
      schuetze: name,
      waffenart: state.waffenart,
      visierung: state.visierung,
      kaliber: state.kaliber,
      kaliberDetail: state.kaliberDetail,
      treffer: result.counts,
      m: result.m,
      schussSumme: result.erfasst,
      endergebnis: result.endergebnis,
      zeitLabel: result.zeitLabel,
      zeitSekunden: result.zeitSekunden,
      zeitWarnung: result.zeitWarnung,
      datumIso: now.toISOString(),
      datumLabel: formatDateTime(now)
    };

    var sessions = loadSessions();
    sessions.unshift(session);
    saveSessions(sessions);
    updateSchuetzenListe();
    resetForm();

    els.tabs.forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-tab") === "verlauf"); });
    els.views.forEach(function (v) { v.classList.toggle("active", v.id === "view-verlauf"); });
    renderVerlauf();
  }

  function formatDateTime(d) {
    var dd = String(d.getDate()).padStart(2, "0");
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var yyyy = d.getFullYear();
    var hh = String(d.getHours()).padStart(2, "0");
    var min = String(d.getMinutes()).padStart(2, "0");
    return dd + "." + mm + "." + yyyy + ", " + hh + ":" + min;
  }

  function resetForm() {
    els.schuetze.value = "Jud";
    els.mainInputs.forEach(function (inp) { inp.value = ""; });
    els.trefferM.value = "";
    els.zeit.value = "";
    els.zeitHint.hidden = true;
    els.mHint.hidden = true;
    state.waffenart = null;
    state.kaliber = null;
    state.kaliberDetail = null;
    document.querySelectorAll(".btn-group button.selected").forEach(function (b) {
      b.classList.remove("selected");
    });
    els.kaliberDetailField.hidden = true;
    state.visierung = VISIERUNG_DEFAULT;
    document.querySelector('[data-group="visierung"] button[data-value="' + VISIERUNG_DEFAULT + '"]').classList.add("selected");
    calculate();
  }

  function renderVerlauf() {
    var sessions = loadSessions();
    var gesamt = sessions.length;
    var gefiltert = false;

    var nameFilter = els.filterSchuetze.value.trim().toLowerCase();
    if (nameFilter) {
      gefiltert = true;
      sessions = sessions.filter(function (s) {
        return s.schuetze.toLowerCase().indexOf(nameFilter) !== -1;
      });
    }

    var sportgeraetFilter = els.filterSportgeraet.value;
    if (sportgeraetFilter) {
      gefiltert = true;
      var parts = sportgeraetFilter.split("|");
      sessions = sessions.filter(function (s) {
        return s.waffenart === parts[0] && s.kaliber === parts[1];
      });
    }

    var kaliberDetailFilter = els.filterKaliberDetail.value;
    if (kaliberDetailFilter) {
      gefiltert = true;
      sessions = sessions.filter(function (s) {
        return s.kaliberDetail === kaliberDetailFilter;
      });
    }

    if (sessions.length === 0) {
      var leerText = (gefiltert && gesamt > 0)
        ? "Keine Einträge für diesen Filter gefunden."
        : "Noch keine Einträge.";
      els.verlaufListe.innerHTML = '<div class="verlauf-empty">' + leerText + '</div>';
      return;
    }

    els.verlaufListe.innerHTML = sessions.map(function (s) {
      var zeitTeil = s.zeitLabel ? (" · Zeit " + s.zeitLabel) : "";
      var visierungTeil = s.visierung ? (" · " + escapeHtml(s.visierung)) : "";
      var kaliberTeil = s.kaliber + (s.kaliberDetail ? " (" + s.kaliberDetail + ")" : "");
      return (
        '<div class="verlauf-item" data-id="' + s.id + '">' +
          '<div class="vi-left">' +
            '<span class="vi-name">' + escapeHtml(s.schuetze) + '</span>' +
            '<span class="vi-meta">' + s.datumLabel + ' · ' + escapeHtml(s.waffenart) + visierungTeil + ' · ' + escapeHtml(kaliberTeil) + zeitTeil + '</span>' +
          '</div>' +
          '<div class="vi-score">' + s.endergebnis + '</div>' +
        '</div>'
      );
    }).join("");

    Array.prototype.forEach.call(els.verlaufListe.querySelectorAll(".verlauf-item"), function (item) {
      item.addEventListener("click", function () {
        openModal(item.getAttribute("data-id"));
      });
    });
  }

  var currentModalId = null;

  function openModal(id) {
    var sessions = loadSessions();
    var s = sessions.find(function (x) { return x.id === id; });
    if (!s) return;
    currentModalId = id;

    var trefferRows = MAIN_KEYS.map(function (k) {
      var label = (k === "fehler") ? "Fehler" : k + "er";
      return '<div class="detail-row"><span>' + label + '</span><span>' + (s.treffer[k] || 0) + '</span></div>';
    }).join("");

    els.modalContent.innerHTML =
      '<div class="detail-row"><span>Schütze</span><span>' + escapeHtml(s.schuetze) + '</span></div>' +
      '<div class="detail-row"><span>Datum</span><span>' + s.datumLabel + '</span></div>' +
      '<div class="detail-row"><span>Waffenart</span><span>' + escapeHtml(s.waffenart) + '</span></div>' +
      '<div class="detail-row"><span>Visierung</span><span>' + escapeHtml(s.visierung || "–") + '</span></div>' +
      '<div class="detail-row"><span>Kaliber</span><span>' + escapeHtml(s.kaliber) + (s.kaliberDetail ? " (" + escapeHtml(s.kaliberDetail) + ")" : "") + '</span></div>' +
      '<div class="detail-row"><span>Zeit</span><span>' + (s.zeitLabel || "–") + (s.zeitWarnung ? " ⚠" : "") + '</span></div>' +
      trefferRows +
      '<div class="detail-row"><span>davon M (innerer Zehner)</span><span>' + (s.m || 0) + '</span></div>' +
      '<div class="detail-row"><span>Schuss erfasst</span><span>' + s.schussSumme + ' / ' + SCHUSS_GESAMT + '</span></div>' +
      '<div class="detail-row highlight"><span>Endergebnis</span><strong>' + s.endergebnis + '</strong></div>';

    els.modal.hidden = false;
  }

  function closeModal() {
    els.modal.hidden = true;
    currentModalId = null;
  }

  function showSyncHint(message, isError) {
    els.syncHint.textContent = message;
    els.syncHint.classList.toggle("error", !!isError);
    els.syncHint.hidden = false;
  }

  function exportSessions() {
    var sessions = loadSessions();
    if (sessions.length === 0) {
      showSyncHint("Kein Verlauf zum Exportieren vorhanden.", true);
      return;
    }
    var blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var now = new Date();
    var stamp = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    var a = document.createElement("a");
    a.href = url;
    a.download = "bds-praezision-verlauf-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showSyncHint(sessions.length + " Einträge exportiert.", false);
  }

  function isValidSession(s) {
    return s && typeof s === "object" &&
      typeof s.id === "string" &&
      typeof s.schuetze === "string" &&
      s.treffer && typeof s.treffer === "object" &&
      typeof s.endergebnis === "number";
  }

  function importSessions(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var imported;
      try {
        imported = JSON.parse(reader.result);
      } catch (e) {
        showSyncHint("Datei konnte nicht gelesen werden (kein gültiges JSON).", true);
        return;
      }
      if (!Array.isArray(imported)) {
        showSyncHint("Datei hat kein gültiges Format.", true);
        return;
      }
      var valid = imported.filter(isValidSession);
      if (valid.length === 0) {
        showSyncHint("Keine gültigen Einträge in der Datei gefunden.", true);
        return;
      }

      var existing = loadSessions();
      var existingIds = new Set(existing.map(function (s) { return s.id; }));
      var added = 0;
      valid.forEach(function (s) {
        if (!existingIds.has(s.id)) {
          existing.push(s);
          existingIds.add(s.id);
          added++;
        }
      });

      existing.sort(function (a, b) {
        return new Date(b.datumIso) - new Date(a.datumIso);
      });

      saveSessions(existing);
      updateSchuetzenListe();
      renderVerlauf();

      var skipped = valid.length - added;
      var msg = added + " neue Einträge importiert.";
      if (skipped > 0) msg += " " + skipped + " bereits vorhanden (übersprungen).";
      showSyncHint(msg, false);
    };
    reader.onerror = function () {
      showSyncHint("Datei konnte nicht gelesen werden.", true);
    };
    reader.readAsText(file);
  }

  function els_ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  els_ready(init);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () {});
    });
  }
})();

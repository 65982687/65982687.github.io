(function () {
    "use strict";

    var themes = ["paper", "night", "dark"];
    var root = document.documentElement;
    var privateFrameObservers = new WeakMap();

    function isTheme(value) {
        return themes.indexOf(value) !== -1;
    }

    function privateDocumentHeight(frameDocument) {
        var bodyHeight = frameDocument.body ? frameDocument.body.scrollHeight : 0;
        return Math.max(320, frameDocument.documentElement.scrollHeight, bodyHeight);
    }

    function resizePrivateFrame(frame) {
        try {
            var frameDocument = frame.contentDocument;
            if (!frameDocument || !frameDocument.documentElement) return;
            frame.style.height = Math.ceil(privateDocumentHeight(frameDocument)) + "px";
        } catch (_) {
            // Cross-origin frames cannot be measured from the host page.
        }
    }

    function observePrivateFrame(frame) {
        var previousObserver = privateFrameObservers.get(frame);
        if (previousObserver) previousObserver.disconnect();

        try {
            var frameDocument = frame.contentDocument;
            if (!frameDocument || !frameDocument.documentElement) return;

            if ("ResizeObserver" in window) {
                var observer = new ResizeObserver(function () {
                    window.requestAnimationFrame(function () {
                        resizePrivateFrame(frame);
                    });
                });
                observer.observe(frameDocument.documentElement);
                if (frameDocument.body) observer.observe(frameDocument.body);
                privateFrameObservers.set(frame, observer);
            }
            resizePrivateFrame(frame);
        } catch (_) {
            // Cross-origin frames cannot be observed from the host page.
        }
    }

    function stylePrivateFrame(frame, theme) {
        try {
            var frameDocument = frame.contentDocument;
            if (!frameDocument || !frameDocument.documentElement) return;

            frameDocument.documentElement.dataset.theme = theme;
            if (!frameDocument.querySelector("link[data-note-theme]")) {
                var stylesheet = frameDocument.createElement("link");
                stylesheet.rel = "stylesheet";
                stylesheet.href = "/css/default.css";
                stylesheet.dataset.noteTheme = "";
                frameDocument.head.appendChild(stylesheet);
            }
            observePrivateFrame(frame);
        } catch (_) {
            // Cross-origin frames cannot be styled from the host page.
        }
    }

    function syncPrivateFrames(theme) {
        document.querySelectorAll("iframe.private-content").forEach(function (frame) {
            stylePrivateFrame(frame, theme);
        });
    }

    function reportPrivateDocumentHeight() {
        if (window.parent === window || !document.body) return;
        var height = Math.max(root.scrollHeight, document.body.scrollHeight);
        window.parent.postMessage({
            type: "private-content-height",
            height: Math.ceil(height)
        }, window.location.origin);
    }

    function observePrivateDocument() {
        if (window.parent === window) return;

        if ("ResizeObserver" in window) {
            var observer = new ResizeObserver(function () {
                window.requestAnimationFrame(reportPrivateDocumentHeight);
            });
            observer.observe(root);
            if (document.body) observer.observe(document.body);
        }

        window.requestAnimationFrame(reportPrivateDocumentHeight);
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(reportPrivateDocumentHeight);
        }
    }

    function splitConsentItems(value) {
        if (!value) return [
            "この先に強い表現が含まれることを理解しました",
            "自分の判断で閲覧します",
            "必要になったら閲覧を中止します"
        ];

        return value.split("|").map(function (item) {
            return item.trim();
        }).filter(Boolean);
    }

    function consentStorageKey(gate, index) {
        var key = gate.dataset.consentKey || gate.id || String(index + 1);
        return "note-consent:" + window.location.pathname + ":" + key;
    }

    function getConsentStorage(mode) {
        if (mode === "local") return localStorage;
        if (mode === "session") return sessionStorage;
        return null;
    }

    function createElement(name, className, text) {
        var element = document.createElement(name);
        if (className) element.className = className;
        if (text) element.textContent = text;
        return element;
    }

    function unlockConsentGate(gate, key, storage) {
        gate.dataset.consentState = "unlocked";
        gate.setAttribute("aria-label", "同意済みの内容");

        if (storage) {
            try {
                storage.setItem(key, "accepted");
            } catch (_) {
                // Consent still applies for the current DOM when storage is unavailable.
            }
        }

        reportPrivateDocumentHeight();
    }

    function initConsentGate(gate, index) {
        if (gate.dataset.consentReady === "true") return;

        var remember = gate.dataset.consentRemember || "";
        var storage;
        try {
            storage = getConsentStorage(remember);
        } catch (_) {
            storage = null;
        }

        var key = consentStorageKey(gate, index);
        try {
            if (storage && storage.getItem(key) === "accepted") {
                gate.dataset.consentState = "unlocked";
                gate.dataset.consentReady = "true";
                return;
            }
        } catch (_) {
            storage = null;
        }

        var content = createElement("div", "consent-gate-content");
        while (gate.firstChild) content.appendChild(gate.firstChild);

        var title = gate.dataset.consentTitle || "内容確認";
        var lead = gate.dataset.consentLead || "この先の内容を表示するには、すべての項目に同意してください。";
        var buttonLabel = gate.dataset.consentButton || "同意して表示";
        var items = splitConsentItems(gate.dataset.consentItems);

        var panel = createElement("div", "consent-gate-panel");
        var panelTitle = createElement("strong", "consent-gate-title", title);
        var panelLead = createElement("p", "consent-gate-lead", lead);
        panel.appendChild(panelTitle);
        panel.appendChild(panelLead);
        var list = createElement("div", "consent-checklist");
        var acceptButton = createElement("button", "consent-accept", buttonLabel);
        var actions = createElement("div", "consent-gate-actions");

        acceptButton.type = "button";
        acceptButton.disabled = true;

        items.forEach(function (item, itemIndex) {
            var label = createElement("label", "consent-check");
            var checkbox = document.createElement("input");
            var span = createElement("span", "", item);
            checkbox.type = "checkbox";
            checkbox.name = "consent-" + index + "-" + itemIndex;
            label.appendChild(checkbox);
            label.appendChild(span);
            list.appendChild(label);
        });

        function refreshAcceptButton() {
            var checkboxes = list.querySelectorAll("input[type='checkbox']");
            var allChecked = Array.prototype.every.call(checkboxes, function (checkbox) {
                return checkbox.checked;
            });
            acceptButton.disabled = !allChecked;
        }

        list.addEventListener("change", refreshAcceptButton);
        acceptButton.addEventListener("click", function () {
            if (acceptButton.disabled) return;
            unlockConsentGate(gate, key, storage);
        });

        actions.appendChild(acceptButton);
        panel.appendChild(list);
        panel.appendChild(actions);

        gate.appendChild(panel);
        gate.appendChild(content);
        gate.dataset.consentState = "locked";
        gate.dataset.consentReady = "true";
        gate.setAttribute("aria-label", "同意が必要な内容");
        refreshAcceptButton();
    }

    function initConsentGates() {
        document.querySelectorAll(".consent-gate").forEach(initConsentGate);
    }

    function initReveals() {
        document.querySelectorAll(".reveal").forEach(function (gate, index) {
            if (gate.dataset.revealReady === "true") return;
            var warning = Array.from(gate.children).find(function (child) {
                return child.classList.contains("reveal-warning");
            });
            if (!warning) warning = createElement("div", "reveal-warning", "続きを表示しますか？");
            var content = createElement("div", "reveal-content");
            content.id = "reveal-content-" + index;
            content.tabIndex = -1;
            content.hidden = true;
            Array.from(gate.childNodes).forEach(function (child) {
                if (child !== warning) content.appendChild(child);
            });
            var panel = createElement("div", "reveal-panel");
            var button = createElement("button", "consent-accept", gate.dataset.revealButton || "同意して表示");
            button.type = "button";
            button.setAttribute("aria-controls", content.id);
            button.setAttribute("aria-expanded", "false");
            panel.appendChild(warning);
            panel.appendChild(button);
            gate.appendChild(panel);
            gate.appendChild(content);
            gate.dataset.revealReady = "true";
            button.addEventListener("click", function () {
                content.hidden = false;
                button.setAttribute("aria-expanded", "true");
                panel.hidden = true;
                content.focus({ preventScroll: true });
                reportPrivateDocumentHeight();
            });
        });
    }

    function setTheme(theme, persist) {
        if (!isTheme(theme)) return;
        root.dataset.theme = theme;
        if (persist) localStorage.setItem("note-theme", theme);
        syncPrivateFrames(theme);

        document.querySelectorAll("[data-set-theme]").forEach(function (button) {
            var active = button.dataset.setTheme === theme;
            button.setAttribute("aria-pressed", String(active));
        });
    }

    try {
        var savedTheme = localStorage.getItem("note-theme");
        if (isTheme(savedTheme)) setTheme(savedTheme, false);
    } catch (_) {
        // The frontmatter theme remains active when storage is unavailable.
    }

    document.addEventListener("DOMContentLoaded", function () {
        initConsentGates();
        initReveals();
        document.querySelectorAll("iframe.private-content").forEach(function (frame) {
            frame.addEventListener("load", function () {
                stylePrivateFrame(frame, root.dataset.theme);
            });
        });
        observePrivateDocument();
        setTheme(root.dataset.theme, false);
        document.querySelectorAll("[data-set-theme]").forEach(function (button) {
            button.addEventListener("click", function () {
                try {
                    setTheme(button.dataset.setTheme, true);
                } catch (_) {
                    setTheme(button.dataset.setTheme, false);
                }
            });
        });
    });

    window.addEventListener("message", function (event) {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== "private-content-height") return;
        if (!Number.isFinite(event.data.height) || event.data.height < 0) return;

        document.querySelectorAll("iframe.private-content").forEach(function (frame) {
            if (frame.contentWindow !== event.source) return;
            frame.style.height = Math.max(320, Math.ceil(event.data.height)) + "px";
        });
    });
}());

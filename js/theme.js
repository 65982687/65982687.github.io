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

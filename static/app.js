(function () {
    "use strict";

    var dropzone      = document.getElementById("dropzone");
    var fileInput     = document.getElementById("fileInput");
    var folderInput   = document.getElementById("folderInput");
    var fileBtn       = document.getElementById("fileBtn");
    var folderBtn     = document.getElementById("folderBtn");
    var uploadResults = document.getElementById("uploadResults");
    var resultsList   = document.getElementById("resultsList");
    var fontTableBody = document.getElementById("fontTableBody");
    var emptyState    = document.getElementById("emptyState");
    var fontCount     = document.getElementById("fontCount");
    var refreshBtn    = document.getElementById("refreshBtn");

    var previewModal     = document.getElementById("previewModal");
    var previewClose     = document.getElementById("previewClose");
    var previewTitle     = document.getElementById("previewTitle");
    var previewText      = document.getElementById("previewText");
    var previewSize      = document.getElementById("previewSize");
    var previewSizeLabel = document.getElementById("previewSizeLabel");
    var previewArea      = document.getElementById("previewArea");
    var subfontRow       = document.getElementById("subfontRow");
    var subfontSelect    = document.getElementById("subfontSelect");
    var cjkWarning       = document.getElementById("cjkWarning");

    var fontFaceCounter = 0;
    var currentPreviewFontId = null;
    var allSubfonts = []; // Store full subfont list for filtering

    fileBtn.addEventListener("click", function () { fileInput.click(); });
    folderBtn.addEventListener("click", function () { folderInput.click(); });
    fileInput.addEventListener("change", function () {
        if (fileInput.files.length > 0) { uploadFiles(fileInput.files); fileInput.value = ""; }
    });
    folderInput.addEventListener("change", function () {
        if (folderInput.files.length > 0) { uploadFiles(folderInput.files); folderInput.value = ""; }
    });

    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop",     function (e) { e.preventDefault(); });

    var dragDepth = 0;
    dropzone.addEventListener("dragenter", function (e) { e.preventDefault(); dragDepth++; dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragover",  function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; });
    dropzone.addEventListener("dragleave", function (e) { e.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; dropzone.classList.remove("dragover"); } });
    dropzone.addEventListener("drop", function (e) {
        e.preventDefault(); e.stopPropagation(); dragDepth = 0; dropzone.classList.remove("dragover");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
    });

    function uploadFiles(fileList) {
        var fd = new FormData();
        var fontExts = [".ttf", ".otf", ".ttc"];
        var added = 0;
        for (var i = 0; i < fileList.length; i++) {
            var nm = fileList[i].name.toLowerCase();
            for (var j = 0; j < fontExts.length; j++) {
                if (nm.endsWith(fontExts[j])) { fd.append("files", fileList[i]); added++; break; }
            }
        }
        if (added === 0) { showMessage("没有找到 TTF / OTF / TTC 文件", "error"); return; }
        showMessage("正在上传 " + added + " 个文件…", "loading");
        fetch("/api/upload", { method: "POST", body: fd })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.status === "ok" && data.results) { renderResults(data.results); loadFontList(); }
                else { showMessage(data.message || "上传失败", "error"); }
            })
            .catch(function (err) { showMessage("网络错误: " + err.message, "error"); });
    }

    function showMessage(msg, type) {
        uploadResults.style.display = "block";
        var icon = type === "loading" ? "⏳" : "❌";
        resultsList.innerHTML = '<div class="result-item ' + type + '"><span class="result-icon">' + icon + '</span><span class="result-message">' + escapeHtml(msg) + '</span></div>';
    }

    function renderResults(results) {
        uploadResults.style.display = "block";
        resultsList.innerHTML = "";
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var icon = r.status === "success" ? "✅" : r.status === "duplicate" ? "⚠️" : r.status === "skipped" ? "⏭️" : "❌";
            var el = document.createElement("div");
            el.className = "result-item " + r.status;
            el.innerHTML = '<span class="result-icon">' + icon + '</span><span class="result-filename">' + escapeHtml(r.filename) + '</span><span class="result-message">' + escapeHtml(r.message) + '</span>';
            resultsList.appendChild(el);
        }
    }

    function loadFontList() {
        fetch("/api/fonts")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.status === "ok") { renderFontList(data.fonts); loadAllCjkInfo(data.fonts); }
            })
            .catch(function (e) { console.error("load fonts failed:", e); });
    }

    function renderFontList(fonts) {
        fontTableBody.innerHTML = "";
        fontCount.textContent = fonts.length > 0 ? "共 " + fonts.length + " 个" : "";
        emptyState.style.display = fonts.length === 0 ? "block" : "none";
        for (var i = 0; i < fonts.length; i++) {
            var f = fonts[i];
            var tr = document.createElement("tr");
            var label = escapeHtml(f.family_name) + " - " + escapeHtml(f.style_name);
            tr.innerHTML =
                "<td>" + escapeHtml(f.family_name) + "</td>" +
                "<td>" + escapeHtml(f.style_name) + "</td>" +
                '<td id="cjk-' + f.id + '"><span class="cjk-badge cjk-badge-none">检测中…</span></td>' +
                "<td>" + escapeHtml(f.format.toUpperCase()) + "</td>" +
                "<td>" + fmtSize(f.file_size) + "</td>" +
                '<td><button class="btn btn-info" onclick="FM.preview(' + f.id + ",'" + label.replace(/'/g, "\\'") + "','" + f.format + "')\">预览</button> " +
                '<button class="btn btn-success" onclick="FM.download(' + f.id + ')">下载</button> ' +
                '<button class="btn btn-danger" onclick="FM.del(' + f.id + ",'" + label.replace(/'/g, "\\'") + "')\">删除</button></td>";
            fontTableBody.appendChild(tr);
        }
    }

    function loadAllCjkInfo(fonts) {
        for (var i = 0; i < fonts.length; i++) {
            (function (fontId) {
                fetch("/api/fonts/" + fontId + "/cjk")
                    .then(function (r) { return r.json(); })
                    .then(function (data) { if (data.status === "ok") renderCjkCell(fontId, data.cjk); })
                    .catch(function () {});
            })(fonts[i].id);
        }
    }

    function renderCjkCell(fontId, cjk) {
        var cell = document.getElementById("cjk-" + fontId);
        if (!cell) return;
        var html = '<div class="cjk-badges">';
        if (!cjk.has_cjk) {
            html += '<span class="cjk-badge cjk-badge-none">无中文</span>';
        } else {
            if (cjk.supports_sc) html += '<span class="cjk-badge cjk-badge-sc">简</span>';
            if (cjk.supports_tc) html += '<span class="cjk-badge cjk-badge-tc">繁</span>';
            if (cjk.supports_ja) html += '<span class="cjk-badge cjk-badge-ja">日</span>';
            if (cjk.supports_ko) html += '<span class="cjk-badge cjk-badge-ko">韩</span>';
            if (!cjk.supports_sc && !cjk.supports_tc && !cjk.supports_ja && !cjk.supports_ko) html += '<span class="cjk-badge cjk-badge-sc">CJK</span>';
        }
        html += '</div>';
        if (cjk.warning) html += '<div class="cjk-warning-inline">⚠️ ' + escapeHtml(cjk.warning) + '</div>';
        cell.innerHTML = html;
    }

    // ─── Preview ────────────────────────────────────────────────────────────

    function preview(fontId, displayName, fontFormat) {
        currentPreviewFontId = fontId;
        previewTitle.textContent = "预览 — " + displayName;
        previewText.value = "字体预览 FontPreview 123";
        previewSize.value = 36;
        previewSizeLabel.textContent = "36px";
        cjkWarning.style.display = "none";
        subfontSelect.innerHTML = "";
        subfontRow.style.display = "none";

        if (fontFormat === "ttc") {
            fetch("/api/fonts/" + fontId + "/subfonts")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.status === "ok" && data.subfonts && data.subfonts.length > 0) {
                        allSubfonts = data.subfonts;
                        if (allSubfonts.length > 1) {
                            buildSubfontSelector(allSubfonts);
                            subfontRow.style.display = "flex";
                        }
                        loadPreviewFont(fontId, allSubfonts[0].index);
                        loadCjkForSubfont(fontId, allSubfonts[0].index);
                    }
                })
                .catch(function () { loadPreviewFont(fontId, null); });
        } else {
            loadPreviewFont(fontId, null);
            loadCjkForSubfont(fontId, 0);
        }

        previewArea.style.fontSize = "36px";
        previewArea.textContent = previewText.value;
        previewModal.style.display = "flex";
    }

    function buildSubfontSelector(subfonts) {
        subfontSelect.innerHTML = "";

        // Check if sub-fonts have region info
        var regionCount = {};
        for (var i = 0; i < subfonts.length; i++) {
            var sf = subfonts[i];
            if (sf.region) {
                if (!regionCount[sf.region]) regionCount[sf.region] = 0;
                regionCount[sf.region]++;
            }
        }
        var regionKeys = Object.keys(regionCount);
        var hasRegions = regionKeys.length > 0;

        if (hasRegions) {
            // Group by region, then by weight within each region
            var grouped = {};
            for (var i = 0; i < subfonts.length; i++) {
                var sf = subfonts[i];
                var region = sf.region || "Other";
                if (!grouped[region]) grouped[region] = [];
                grouped[region].push(sf);
            }

            // Build optgroups with language labels
            var regionLabels = {
                SC: "简体中文 (SC)",
                TC: "繁体中文 (TC)",
                HK: "香港繁体 (HK)",
                JP: "日文 (JP)",
                KR: "韩文 (KR)",
                Other: "其他"
            };
            var regionOrder = ["SC", "TC", "HK", "JP", "KR", "Other"];
            for (var r = 0; r < regionOrder.length; r++) {
                var regionKey = regionOrder[r];
                if (!grouped[regionKey]) continue;
                var optgroup = document.createElement("optgroup");
                optgroup.label = regionLabels[regionKey] || regionKey;
                var subs = grouped[regionKey];
                for (var j = 0; j < subs.length; j++) {
                    var opt = document.createElement("option");
                    opt.value = subs[j].index;
                    var label = subs[j].weight || subs[j].style_name || "Regular";
                    // Show count if multiple sub-fonts share same weight label
                    opt.textContent = label;
                    optgroup.appendChild(opt);
                }
                subfontSelect.appendChild(optgroup);
            }
        } else {
            // No region info — flat list with full name
            for (var i = 0; i < subfonts.length; i++) {
                var opt = document.createElement("option");
                opt.value = subfonts[i].index;
                var label = subfonts[i].family_name;
                if (subfonts[i].style_name) label += " — " + subfonts[i].style_name;
                opt.textContent = label;
                subfontSelect.appendChild(opt);
            }
        }
    }

    function loadPreviewFont(fontId, subfontIndex) {
        fontFaceCounter++;
        var faceName = "PreviewFont_" + fontFaceCounter;
        var fontUrl = "/api/fonts/" + fontId + "/file";
        if (subfontIndex !== null && subfontIndex !== undefined) fontUrl += "?subfont=" + subfontIndex;

        var oldStyle = document.getElementById("previewFontStyle");
        if (oldStyle) oldStyle.remove();
        var style = document.createElement("style");
        style.id = "previewFontStyle";
        style.textContent = "@font-face { font-family: '" + faceName + "'; src: url('" + fontUrl + "'); }" +
                            ".preview-area { font-family: '" + faceName + "', sans-serif; }";
        document.head.appendChild(style);
    }

    function loadCjkForSubfont(fontId, subfontIndex) {
        cjkWarning.style.display = "none";
        fetch("/api/fonts/" + fontId + "/cjk" + (subfontIndex !== null ? "?subfont=" + subfontIndex : ""))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.status === "ok" && data.cjk.warning) {
                    cjkWarning.textContent = "⚠️ " + data.cjk.warning;
                    cjkWarning.style.display = "block";
                }
            })
            .catch(function () {});
    }

    subfontSelect.addEventListener("change", function () {
        var idx = parseInt(subfontSelect.value, 10);
        loadPreviewFont(currentPreviewFontId, idx);
        loadCjkForSubfont(currentPreviewFontId, idx);
    });

    previewClose.addEventListener("click", function () { previewModal.style.display = "none"; });
    previewModal.querySelector(".modal-overlay").addEventListener("click", function () { previewModal.style.display = "none"; });
    previewText.addEventListener("input", function () { previewArea.textContent = previewText.value || "字体预览 FontPreview 123"; });
    previewSize.addEventListener("input", function () {
        var size = previewSize.value + "px";
        previewArea.style.fontSize = size;
        previewSizeLabel.textContent = size;
    });

    function download(fontId) { window.open("/api/fonts/" + fontId + "/file?download=1", "_blank"); }

    function del(id, name) {
        if (!confirm("确定删除 \"" + name + "\" ？")) return;
        fetch("/api/fonts/" + id, { method: "DELETE" })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.status === "ok") loadFontList(); else alert("删除失败: " + (d.message || "未知错误")); })
            .catch(function (e) { alert("删除失败: " + e.message); });
    }

    window.FM = { del: del, preview: preview, download: download };

    function escapeHtml(t) { var d = document.createElement("div"); d.textContent = t || ""; return d.innerHTML; }
    function fmtSize(b) { if (b < 1024) return b + " B"; if (b < 1048576) return (b / 1024).toFixed(1) + " KB"; return (b / 1048576).toFixed(1) + " MB"; }
    function fmtDate(ts) { if (!ts) return ""; var d = new Date(ts); return d.toLocaleDateString("zh-CN") + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }

    refreshBtn.addEventListener("click", loadFontList);

    var downloadAllBtn = document.getElementById("downloadAllBtn");
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener("click", function () {
            window.open("/api/fonts/download-all", "_blank");
        });
    }

    loadFontList();
})();

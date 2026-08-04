// FontManager Frontend

document.addEventListener("DOMContentLoaded", () => {
    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("fileInput");
    const uploadResults = document.getElementById("uploadResults");
    const resultsList = document.getElementById("resultsList");
    const fontTableBody = document.getElementById("fontTableBody");
    const emptyState = document.getElementById("emptyState");
    const refreshBtn = document.getElementById("refreshBtn");

    // ─── Prevent browser default drag behavior globally ─────────────────────
    // Without this, dropping a file on the page triggers a download/navigate.

    document.addEventListener("dragover", (e) => {
        e.preventDefault();
    });

    document.addEventListener("drop", (e) => {
        e.preventDefault();
    });

    // ─── Drop Zone ──────────────────────────────────────────────────────────

    dropzone.addEventListener("click", () => fileInput.click());

    dropzone.addEventListener("dragenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
    });

    dropzone.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only remove highlight when actually leaving the dropzone
        if (!dropzone.contains(e.relatedTarget)) {
            dropzone.classList.remove("dragover");
        }
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("dragover");
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            uploadFiles(files);
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            uploadFiles(fileInput.files);
            fileInput.value = "";
        }
    });

    // ─── Upload ─────────────────────────────────────────────────────────────

    async function uploadFiles(files) {
        const formData = new FormData();
        for (const file of files) {
            formData.append("files", file);
        }

        uploadResults.style.display = "block";
        resultsList.innerHTML = '<div class="result-item"><span class="result-icon">⏳</span><span class="result-filename">正在上传和解析...</span></div>';

        try {
            const resp = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });
            const data = await resp.json();

            if (data.status === "ok") {
                renderUploadResults(data.results);
                loadFontList();
            } else {
                resultsList.innerHTML = `<div class="result-item error"><span class="result-icon">❌</span><span class="result-filename">${data.message || "Upload failed"}</span></div>`;
            }
        } catch (err) {
            resultsList.innerHTML = `<div class="result-item error"><span class="result-icon">❌</span><span class="result-filename">Network error: ${err.message}</span></div>`;
        }
    }

    function renderUploadResults(results) {
        resultsList.innerHTML = "";
        for (const r of results) {
            const icon = r.status === "success" ? "✅" : r.status === "duplicate" ? "⚠️" : "❌";
            const item = document.createElement("div");
            item.className = `result-item ${r.status}`;
            item.innerHTML = `
                <span class="result-icon">${icon}</span>
                <span class="result-filename">${escapeHtml(r.filename)}</span>
                <span class="result-message">${escapeHtml(r.message)}</span>
            `;
            resultsList.appendChild(item);
        }
    }

    // ─── Font List ──────────────────────────────────────────────────────────

    async function loadFontList() {
        try {
            const resp = await fetch("/api/fonts");
            const data = await resp.json();
            if (data.status === "ok") {
                renderFontList(data.fonts);
            }
        } catch (err) {
            console.error("Failed to load fonts:", err);
        }
    }

    function renderFontList(fonts) {
        fontTableBody.innerHTML = "";
        if (fonts.length === 0) {
            emptyState.style.display = "block";
            return;
        }
        emptyState.style.display = "none";
        for (const font of fonts) {
            const tr = document.createElement("tr");
            const safeName = escapeHtml(font.family_name + " - " + font.style_name);
            tr.innerHTML = `
                <td>${escapeHtml(font.family_name)}</td>
                <td>${escapeHtml(font.style_name)}</td>
                <td>${escapeHtml(font.format.toUpperCase())}</td>
                <td>${formatFileSize(font.file_size)}</td>
                <td>${formatDate(font.created_at)}</td>
                <td><button class="btn btn-danger btn-sm" onclick="deleteFont(${font.id}, '${safeName}')">删除</button></td>
            `;
            fontTableBody.appendChild(tr);
        }
    }

    // ─── Delete ─────────────────────────────────────────────────────────────

    window.deleteFont = async function (id, displayName) {
        if (!confirm(`确定要删除字体 "${displayName}" 吗？\n此操作将同时删除服务器上的字体文件。`)) {
            return;
        }
        try {
            const resp = await fetch(`/api/fonts/${id}`, { method: "DELETE" });
            const data = await resp.json();
            if (data.status === "ok") {
                loadFontList();
            } else {
                alert("删除失败: " + (data.message || "Unknown error"));
            }
        } catch (err) {
            alert("删除失败: " + err.message);
        }
    };

    // ─── Helpers ────────────────────────────────────────────────────────────

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text || "";
        return div.innerHTML;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function formatDate(ts) {
        if (!ts) return "";
        const d = new Date(ts);
        return d.toLocaleDateString("zh-CN") + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }

    // ─── Init ───────────────────────────────────────────────────────────────

    refreshBtn.addEventListener("click", loadFontList);
    loadFontList();
});

// ===== State =====
let currentPath = '/';
let sortKey = 'name';
let sortDir = 'asc';
let allFiles = [];

// ===== API Helper =====
async function api(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok || !data.success) {
        throw new Error(data.message || 'Request failed');
    }
    return data;
}

// ===== File Icons =====
const FILE_ICONS = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
};

function getFileIcon(name, isDir) {
    if (isDir) return FILE_ICONS.folder;
    const ext = name.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','gif','bmp','webp','svg','ico','tiff'].includes(ext)) return FILE_ICONS.image;
    if (['mp4','avi','mkv','mov','wmv','flv','webm'].includes(ext)) return FILE_ICONS.video;
    if (['mp3','wav','flac','aac','ogg','m4a'].includes(ext)) return FILE_ICONS.audio;
    if (['js','ts','jsx','tsx','go','py','java','c','cpp','rs','html','css','json','xml','sh','yml','yaml','toml','vue','php'].includes(ext)) return FILE_ICONS.code;
    if (['txt','md','log','csv','rtf','doc','docx'].includes(ext)) return FILE_ICONS.text;
    if (['zip','rar','7z','tar','gz','bz2','xz'].includes(ext)) return FILE_ICONS.archive;
    return FILE_ICONS.file;
}

// ===== Format Helpers =====
function formatSize(bytes) {
    if (bytes === 0 || bytes === undefined) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return val.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatDate(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (dateOnly.getTime() === today.getTime()) {
        return 'Today ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    if (dateOnly.getTime() === today.getTime() - 86400000) {
        return 'Yesterday';
    }
    if (diff < 7 * 86400000) {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        return days[date.getDay()];
    }
    return date.toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

// ===== Render =====
function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    bc.innerHTML = '';
    const parts = currentPath.split('/').filter(Boolean);
    
    // Home
    const home = document.createElement('span');
    home.className = 'breadcrumb-item active';
    home.textContent = 'Home';
    home.onclick = () => navigateTo('/');
    bc.appendChild(home);

    parts.forEach((part, i) => {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.textContent = '/';
        bc.appendChild(sep);

        const item = document.createElement('span');
        item.className = 'breadcrumb-item';
        item.textContent = part;
        item.onclick = () => {
            const path = '/' + parts.slice(0, i + 1).join('/');
            navigateTo(path);
        };
        bc.appendChild(item);
    });

    // Update active
    const items = bc.querySelectorAll('.breadcrumb-item');
    items.forEach((item, i) => {
        item.classList.remove('active');
        if (i === items.length - 1) item.classList.add('active');
    });

    // Show/hide back button
    const backBtn = document.getElementById('backBtn');
    backBtn.style.display = (currentPath === '/') ? 'none' : 'inline-flex';
}

function renderTable() {
    const tbody = document.getElementById('fileTableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = '';

    // Apply search filter
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();
    let files = allFiles;
    if (searchQuery) {
        files = files.filter(f => f.name.toLowerCase().includes(searchQuery));
    }

    // Apply sorting
    files = [...files].sort((a, b) => {
        // Directories always first
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        
        let valA, valB;
        switch (sortKey) {
            case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
            case 'lastModified': valA = a.lastModified; valB = b.lastModified; break;
            case 'size': valA = a.size || 0; valB = b.size || 0; break;
            default: return 0;
        }
        
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    if (files.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';

    files.forEach(file => {
        const tr = document.createElement('tr');
        
        // Name cell
        const nameTd = document.createElement('td');
        const nameDiv = document.createElement('div');
        nameDiv.className = 'file-name-cell';
        nameDiv.innerHTML = `<span class="file-icon">${getFileIcon(file.name, file.isDir)}</span>`;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = file.name;
        nameDiv.appendChild(nameSpan);
        nameDiv.onclick = () => {
            if (file.isDir) {
                navigateTo(joinPath(currentPath, file.name));
            } else {
                openFile(currentPath, file.name);
            }
        };
        nameTd.appendChild(nameDiv);
        tr.appendChild(nameTd);

        // Modified cell
        const modTd = document.createElement('td');
        modTd.className = 'file-modified';
        modTd.textContent = formatDate(file.lastModified);
        tr.appendChild(modTd);

        // Size cell
        const sizeTd = document.createElement('td');
        sizeTd.className = 'file-size';
        sizeTd.textContent = file.isDir ? '—' : formatSize(file.size);
        tr.appendChild(sizeTd);

        // Actions cell
        const actionsTd = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'row-actions';

        if (!file.isDir) {
            // Download
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'icon-btn';
            downloadBtn.title = '下载';
            downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            downloadBtn.onclick = (e) => { e.stopPropagation(); downloadFile(joinPath(currentPath, file.name)); };
            actionsDiv.appendChild(downloadBtn);

            // Open in new tab
            const openBtn = document.createElement('button');
            openBtn.className = 'icon-btn';
            openBtn.title = '新标签页打开';
            openBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
            openBtn.onclick = (e) => { e.stopPropagation(); openInNewTab(joinPath(currentPath, file.name)); };
            actionsDiv.appendChild(openBtn);

            // Edit (for text files)
            if (isTextFile(file.name)) {
                const editBtn = document.createElement('button');
                editBtn.className = 'icon-btn';
                editBtn.title = '编辑';
                editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                editBtn.onclick = (e) => { e.stopPropagation(); editFile(joinPath(currentPath, file.name), file.name); };
                actionsDiv.appendChild(editBtn);
            }
        }

        // Delete
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn danger';
        deleteBtn.title = '删除';
        deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        deleteBtn.onclick = (e) => { e.stopPropagation(); deleteItem(joinPath(currentPath, file.name), file.name); };
        actionsDiv.appendChild(deleteBtn);

        actionsTd.appendChild(actionsDiv);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
    });

    // Update sort indicators
    document.querySelectorAll('.sortable').forEach(th => {
        const arrow = th.querySelector('.sort-arrow');
        arrow.classList.remove('asc', 'desc');
        if (th.dataset.sort === sortKey) {
            arrow.classList.add(sortDir);
        }
    });
}

function isTextFile(name) {
    const ext = name.split('.').pop().toLowerCase();
    return ['txt','md','log','csv','json','xml','html','css','js','ts','jsx','tsx','go','py','java','c','cpp','rs','sh','yml','yaml','toml','vue','php','ini','conf','env'].includes(ext);
}

// ===== Navigation =====
function joinPath(base, name) {
    if (base === '/') return '/' + name;
    return base + '/' + name;
}

function getParentPath(path) {
    if (!path || path === '/') return '/';
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
}

async function navigateTo(path) {
    currentPath = path || '/';
    await loadFiles();
}

async function loadFiles() {
    try {
        const data = await api(`/api/list?path=${encodeURIComponent(currentPath)}`);
        allFiles = data.data.items || [];
        renderBreadcrumb();
        renderTable();
    } catch (err) {
        showToast('加载失败: ' + err.message, 'error');
    }
}

// ===== File Operations =====
async function downloadFile(path) {
    const link = document.createElement('a');
    link.href = `/api/download?path=${encodeURIComponent(path)}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function openInNewTab(path) {
    window.open(`/api/download?path=${encodeURIComponent(path)}`, '_blank');
}

async function openFile(path, name) {
    if (isTextFile(name)) {
        editFile(path, name);
    } else {
        openInNewTab(path);
    }
}

async function deleteItem(path, name) {
    if (!confirm(`确定删除 "${name}" 吗？`)) return;
    try {
        await api(`/api/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
        showToast('已删除: ' + name);
        await loadFiles();
    } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
    }
}

// ===== Editor =====
let editingFilePath = null;

async function editFile(path, name) {
    editingFilePath = path;
    document.getElementById('editorTitle').textContent = name || '编辑文件';
    document.getElementById('editorTextarea').value = '';
    document.getElementById('editorModal').style.display = 'flex';
    
    try {
        const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
        if (data.data && data.data.content !== undefined) {
            document.getElementById('editorTextarea').value = data.data.content;
        }
    } catch (err) {
        // If can't load, start with empty editor
    }
}

function closeEditor() {
    document.getElementById('editorModal').style.display = 'none';
    editingFilePath = null;
}

async function saveEditor() {
    if (!editingFilePath) return;
    const content = document.getElementById('editorTextarea').value;
    try {
        await api('/api/create-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: currentPath,
                name: editingFilePath.split('/').pop(),
                content: content
            })
        });
        showToast('保存成功');
        closeEditor();
        await loadFiles();
    } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
    }
}

// ===== Upload =====
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
const CHUNK_THRESHOLD = 50 * 1024 * 1024; // Use chunked upload for files > 50MB
const MAX_PARALLEL = 3; // Max parallel chunk uploads

async function uploadFiles(files) {
    if (!files || files.length === 0) return;
    
    const modal = document.getElementById('uploadModal');
    const container = document.getElementById('uploadProgressContainer');
    container.innerHTML = '';
    modal.style.display = 'flex';

    for (const file of files) {
        const item = createUploadItem(file);
        container.appendChild(item.element);
        
        try {
            if (file.size > CHUNK_THRESHOLD) {
                await chunkedUpload(file, item);
            } else {
                await simpleUpload(file, item);
            }
        } catch (err) {
            item.setStatus('error', err.message);
            item.setProgress(100, 'error');
        }
    }

    // Auto close after a delay if all done
    setTimeout(() => {
        modal.style.display = 'none';
        loadFiles();
    }, 1500);
}

function createUploadItem(file) {
    const div = document.createElement('div');
    div.className = 'upload-item';
    div.innerHTML = `
        <div class="upload-item-header">
            <span class="upload-item-name">${escapeHtml(file.name)}</span>
            <span class="upload-item-status">准备中...</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
        <div class="upload-item-header" style="margin-top:4px;">
            <span style="font-size:11px;color:var(--text-muted)">${formatSize(file.size)}</span>
            <span class="upload-item-size" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
    `;
    
    const statusEl = div.querySelector('.upload-item-status');
    const fillEl = div.querySelector('.progress-fill');
    const sizeEl = div.querySelector('.upload-item-size');
    
    return {
        element: div,
        setStatus: (cls, text) => {
            statusEl.textContent = text;
            statusEl.className = 'upload-item-status ' + cls;
        },
        setProgress: (pct, cls) => {
            fillEl.style.width = pct + '%';
            fillEl.className = 'progress-fill' + (cls ? ' ' + cls : '');
        },
        setSpeed: (text) => { sizeEl.textContent = text; }
    };
}

async function simpleUpload(file, item) {
    const formData = new FormData();
    formData.append('file', file);
    
    item.setStatus('', '上传中...');
    item.setProgress(0);

    const xhr = new XMLHttpRequest();
    
    return new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const pct = (e.loaded / e.total) * 100;
                item.setProgress(pct);
                const speed = formatSpeed(e.loaded, e.timeStamp);
                item.setSpeed(speed);
            }
        });
        
        xhr.addEventListener('load', () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (data.success) {
                    item.setProgress(100, 'done');
                    item.setStatus('done', '完成');
                    resolve();
                } else {
                    reject(new Error(data.message || 'Upload failed'));
                }
            } catch {
                reject(new Error('Invalid response'));
            }
        });
        
        xhr.addEventListener('error', () => reject(new Error('Network error')));
        
        xhr.open('POST', `/api/upload?path=${encodeURIComponent(currentPath)}`);
        xhr.send(formData);
    });
}

async function chunkedUpload(file, item) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    // Init upload session
    item.setStatus('', '初始化...');
    const initData = await api('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename: file.name,
            fileSize: file.size,
            totalChunks: totalChunks,
            chunkSize: CHUNK_SIZE,
            path: currentPath
        })
    });
    
    const uploadId = initData.data.uploadId;
    item.setStatus('', '上传中...');
    
    let uploadedChunks = 0;
    const startTime = Date.now();
    let uploadedBytes = 0;
    
    // Upload chunks with limited parallelism
    const chunkQueue = [];
    for (let i = 0; i < totalChunks; i++) {
        chunkQueue.push(i);
    }
    
    async function uploadChunk(chunkIndex) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        const formData = new FormData();
        formData.append('chunk', chunk);
        
        await fetch(`/api/upload/chunk?uploadId=${uploadId}&chunkIndex=${chunkIndex}`, {
            method: 'POST',
            body: chunk
        });
        
        uploadedChunks++;
        uploadedBytes += (end - start);
        const pct = (uploadedChunks / totalChunks) * 100;
        item.setProgress(pct);
        
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = uploadedBytes / elapsed;
        item.setSpeed(`${formatSize(speed)}/s (${uploadedChunks}/${totalChunks})`);
    }
    
    // Process queue with limited concurrency
    while (chunkQueue.length > 0) {
        const batch = chunkQueue.splice(0, MAX_PARALLEL);
        await Promise.all(batch.map(i => uploadChunk(i)));
    }
    
    // Complete upload
    item.setStatus('', '合并中...');
    await api('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId })
    });
    
    item.setProgress(100, 'done');
    item.setStatus('done', '完成');
}

function formatSpeed(loaded, timeStamp) {
    // Approximate speed calculation
    return formatSize(loaded) + ' 已上传';
}

// ===== Toast =====
let toastTimer = null;
function showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Event Listeners =====
document.addEventListener('DOMContentLoaded', () => {
    // Navigation
    document.getElementById('homeBtn').onclick = () => navigateTo('/');
    document.getElementById('backBtn').onclick = () => navigateTo(getParentPath(currentPath));
    document.getElementById('refreshBtn').onclick = () => loadFiles();
    
    // Upload
    document.getElementById('uploadBtn').onclick = () => {
        document.getElementById('fileInput').click();
    };
    document.getElementById('fileInput').onchange = (e) => {
        if (e.target.files.length > 0) {
            uploadFiles(Array.from(e.target.files));
            e.target.value = ''; // Reset for re-upload
        }
    };
    
    // New Folder
    document.getElementById('newFolderBtn').onclick = () => {
        document.getElementById('newFolderName').value = '';
        document.getElementById('newFolderModal').style.display = 'flex';
        document.getElementById('newFolderName').focus();
    };
    document.getElementById('closeNewFolderBtn').onclick = () => {
        document.getElementById('newFolderModal').style.display = 'none';
    };
    document.getElementById('cancelNewFolderBtn').onclick = () => {
        document.getElementById('newFolderModal').style.display = 'none';
    };
    document.getElementById('confirmNewFolderBtn').onclick = async () => {
        const name = document.getElementById('newFolderName').value.trim();
        if (!name) return;
        try {
            await api('/api/mkdir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: currentPath, name })
            });
            showToast('文件夹已创建');
            document.getElementById('newFolderModal').style.display = 'none';
            await loadFiles();
        } catch (err) {
            showToast('创建失败: ' + err.message, 'error');
        }
    };
    document.getElementById('newFolderName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('confirmNewFolderBtn').click();
    });
    
    // New File
    document.getElementById('newFileBtn').onclick = () => {
        document.getElementById('newFileName').value = '';
        document.getElementById('newFileModal').style.display = 'flex';
        document.getElementById('newFileName').focus();
    };
    document.getElementById('closeNewFileBtn').onclick = () => {
        document.getElementById('newFileModal').style.display = 'none';
    };
    document.getElementById('cancelNewFileBtn').onclick = () => {
        document.getElementById('newFileModal').style.display = 'none';
    };
    document.getElementById('confirmNewFileBtn').onclick = async () => {
        const name = document.getElementById('newFileName').value.trim();
        if (!name) return;
        try {
            await api('/api/create-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: currentPath, name, content: '' })
            });
            showToast('文件已创建');
            document.getElementById('newFileModal').style.display = 'none';
            await loadFiles();
        } catch (err) {
            showToast('创建失败: ' + err.message, 'error');
        }
    };
    document.getElementById('newFileName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('confirmNewFileBtn').click();
    });
    
    // Editor
    document.getElementById('closeEditorBtn').onclick = closeEditor;
    document.getElementById('cancelEditorBtn').onclick = closeEditor;
    document.getElementById('saveEditorBtn').onclick = saveEditor;
    
    // Search
    let searchTimer = null;
    document.getElementById('searchInput').oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderTable(), 200);
    };
    
    // Sorting
    document.querySelectorAll('.sortable').forEach(th => {
        th.onclick = () => {
            const key = th.dataset.sort;
            if (sortKey === key) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortKey = key;
                sortDir = 'asc';
            }
            renderTable();
        };
    });
    
    // Drag & Drop
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        document.body.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e) => {
        if (e.target === document.documentElement) {
            document.body.classList.remove('drag-over');
        }
    });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        document.body.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            uploadFiles(Array.from(e.dataTransfer.files));
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => {
                if (m.style.display !== 'none' && m.id !== 'uploadModal') {
                    m.style.display = 'none';
                }
            });
        }
    });
    
    // Initial load
    loadFiles();
});


// ===== State =====
let currentPath = '/';
let sortKey = 'name';
let sortDir = 'asc';
let allFiles = [];
// Pagination only applies to the plain listing. While a search is active the
// filtered result is shown whole, because search is meant to span everything
// in the directory rather than just the current page.
let pageSize = 20;
let currentPage = 1;
const PAGE_SIZES = [10, 20, 50, 100];
// Selected entries are keyed by full path, not by row, so a selection
// survives paging and search. Only paths still present in the current
// directory are ever acted on; navigateTo clears the set.
let selectedPaths = new Set();

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
    if (['txt','md','log','csv','rtf','doc','docx','srt'].includes(ext)) return FILE_ICONS.text;
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

function getSearchQuery() {
    return document.getElementById('searchInput').value.trim().toLowerCase();
}

// Filtering and sorting live here so the table and the pager always agree on
// what the current result set is. Search covers the whole listing, never just
// the current page, which is what makes a match on page 5 findable from page 1.
function getVisibleFiles() {
    const searchQuery = getSearchQuery();
    let files = allFiles;
    if (searchQuery) {
        files = files.filter(f => f.name.toLowerCase().includes(searchQuery));
    }

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
    return files;
}

function renderTable() {
    const tbody = document.getElementById('fileTableBody');
    const emptyState = document.getElementById('emptyState');
    tbody.innerHTML = '';

    const searchQuery = getSearchQuery();
    const files = getVisibleFiles();

    // Pagination is applied after filtering and sorting, so page 1 always
    // holds the first item of the sorted result rather than of the raw list.
    const totalItems = files.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const pageStart = (currentPage - 1) * pageSize;
    const pageItems = searchQuery ? files : files.slice(pageStart, pageStart + pageSize);

    if (totalItems === 0) {
        emptyState.style.display = 'flex';
        emptyState.querySelector('p').textContent = searchQuery ? '未找到匹配的文件' : '此文件夹为空';
        renderPager(0, 1, searchQuery);
        syncSelectionUi();
        return;
    }
    emptyState.style.display = 'none';

    pageItems.forEach(file => {
        const tr = document.createElement('tr');
        const fullPath = joinPath(currentPath, file.name);

        // Select cell
        const selectTd = document.createElement('td');
        selectTd.className = 'col-select';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'row-select';
        cb.checked = selectedPaths.has(fullPath);
        if (cb.checked) tr.classList.add('selected');
        cb.title = '选中 ' + file.name;
        cb.dataset.path = fullPath; // authoritative path; never re-derive from text
        cb.onclick = (e) => e.stopPropagation();
        cb.onchange = () => {
            if (cb.checked) selectedPaths.add(fullPath);
            else selectedPaths.delete(fullPath);
            tr.classList.toggle('selected', cb.checked);
            syncSelectionUi();
        };
        selectTd.appendChild(cb);
        tr.appendChild(selectTd);

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
                openFile(joinPath(currentPath, file.name), file.name, file.preview, file.size);
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
        actionsTd.className = 'col-actions';
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'row-actions';

        if (!file.isDir) {

            // Preview (only for whitelisted types; the backend reports which)
            if (file.preview) {
                const previewBtn = document.createElement('button');
                previewBtn.className = 'icon-btn';
                previewBtn.title = '预览';
                previewBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
                previewBtn.onclick = (e) => { e.stopPropagation(); openFile(fullPath, file.name, file.preview, file.size); };
                actionsDiv.appendChild(previewBtn);
            }

            // Download
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'icon-btn';
            downloadBtn.title = '下载';
            downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            downloadBtn.onclick = (e) => { e.stopPropagation(); downloadFile(fullPath); };
            actionsDiv.appendChild(downloadBtn);

            // Open in new tab (preview endpoint when renderable, else download)
            const openBtn = document.createElement('button');
            openBtn.className = 'icon-btn';
            openBtn.title = file.preview ? '新标签页打开预览' : '新标签页打开';
            openBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
            openBtn.onclick = (e) => { e.stopPropagation(); openInNewTab(fullPath, !!file.preview); };
            actionsDiv.appendChild(openBtn);
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

    renderPager(totalItems, totalPages, searchQuery);
    syncSelectionUi();

    // Update sort indicators
    document.querySelectorAll('.sortable').forEach(th => {
        const arrow = th.querySelector('.sort-arrow');
        arrow.classList.remove('asc', 'desc');
        if (th.dataset.sort === sortKey) {
            arrow.classList.add(sortDir);
        }
    });
}

// Renders the pager. While searching, pagination is suppressed entirely: the
// whole match set is on screen, so showing page controls would be misleading.
// Renders the pager.
//
// The page controls stay visible even when everything fits on one page, with
// both buttons disabled and the counter reading 1 / 1. Hiding them made a small
// folder indistinguishable from a broken pager, and hiding the whole control
// block (an earlier bug) also took the page-size selector with it, stranding the
// user on a size they could not change back. Only search hides the page numbers,
// because then every match is on screen and pagination genuinely does not apply.
function renderPager(totalItems, totalPages, searching) {
    const pager = document.getElementById('pager');
    const info = document.getElementById('pagerInfo');
    const pages = document.getElementById('pagerPages');
    const prev = document.getElementById('prevPageBtn');
    const next = document.getElementById('nextPageBtn');
    const current = document.getElementById('pagerCurrent');

    pager.style.display = 'flex';

    if (searching) {
        // Every match is on screen, so page numbers would be meaningless; the
        // size selector stays so the preference can still be changed.
        pages.style.display = 'none';
        info.textContent = '搜索到 ' + totalItems + ' 项（不受分页限制）';
        return;
    }

    pages.style.display = 'inline-flex';

    if (totalItems <= pageSize) {
        // Single page: show the controls in a disabled state rather than
        // removing them, so the bottom bar always looks the same.
        info.textContent = '共 ' + totalItems + ' 项';
        current.textContent = '1 / 1';
        prev.disabled = true;
        next.disabled = true;
        return;
    }

    const from = (currentPage - 1) * pageSize + 1;
    const to = Math.min(currentPage * pageSize, totalItems);
    info.textContent = '共 ' + totalItems + ' 项，显示 ' + from + '-' + to;
    current.textContent = currentPage + ' / ' + totalPages;
    prev.disabled = currentPage <= 1;
    next.disabled = currentPage >= totalPages;
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
    currentPage = 1; // a new directory starts at its first page
    selectedPaths.clear(); // selections do not follow you between folders
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

function previewUrl(path) {
    return `/api/preview?path=${encodeURIComponent(path)}`;
}

function openInNewTab(path, previewable) {
    window.open(previewable ? previewUrl(path) : `/api/download?path=${encodeURIComponent(path)}`, '_blank');
}

// Opens the preview modal. Text-like files are fetched so they can be shown and
// edited in place; everything else is rendered from /api/preview, which streams
// with Range support so video and audio can be scrubbed without a full download.
async function openFile(path, name, kind, size) {
    if (kind) {
        openPreview(path, name, kind, size);
        return;
    }
    openInNewTab(path);
}

async function deleteItem(path, name) {
    if (!confirm(`确定删除 "${name}" 吗？`)) return;
    try {
        await api(`/api/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
        selectedPaths.delete(path);
        showToast('已删除: ' + name);
        await loadFiles();
    } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
    }
}

// ===== Batch download =====
// The selection is sent to /api/download-batch and comes back as one zip.
// Doing it in the browser is not an option: folders cannot be fetched through
// /api/download at all, and a burst of programmatic downloads is silently
// throttled to the first one.
function downloadSelected() {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;

    const query = paths.map(p => 'path=' + encodeURIComponent(p)).join('&');
    const link = document.createElement('a');
    link.href = '/api/download-batch?' + query;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`正在打包下载 ${paths.length} 项...`);
}

// ===== Batch delete =====
// Deletes the selected paths one by one through the existing single-path
// endpoint, so no backend change is needed. Failures are collected rather than
// aborting the run: one permission error should not strand the other deletions.
async function deleteSelected() {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;

    const names = paths.map(p => p.split('/').pop());
    const preview = names.slice(0, 5).join('、') + (names.length > 5 ? ` 等 ${names.length} 项` : '');
    if (!confirm(`确定删除选中的 ${paths.length} 项吗？\n\n${preview}`)) return;

    const btn = document.getElementById('batchDeleteBtn');
    btn.disabled = true;
    showToast(`正在删除 0/${paths.length}...`);

    const failed = [];
    let done = 0;
    for (const p of paths) {
        try {
            await api(`/api/delete?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
            selectedPaths.delete(p);
        } catch (err) {
            failed.push(p.split('/').pop() + '（' + err.message + '）');
        }
        done++;
        showToast(`正在删除 ${done}/${paths.length}...`);
    }

    btn.disabled = false;
    await loadFiles();

    if (failed.length === 0) {
        showToast(`已删除 ${paths.length} 项`);
    } else {
        showToast(`已删除 ${paths.length - failed.length} 项，${failed.length} 项失败：` + failed.join('；'), 'error');
    }
}

// Keeps the header checkbox and the batch button in step with the selection.
// The header box reflects only the rows currently rendered, so it reads as
// "all items on this page" rather than "all items in the folder".
function syncSelectionUi() {
    const boxes = Array.from(document.querySelectorAll('.row-select'));
    const checkedOnPage = boxes.filter(b => b.checked).length;

    const selectAll = document.getElementById('selectAllCheckbox');
    if (selectAll) {
        selectAll.checked = boxes.length > 0 && checkedOnPage === boxes.length;
        selectAll.indeterminate = checkedOnPage > 0 && checkedOnPage < boxes.length;
        selectAll.disabled = boxes.length === 0;
    }

    const count = selectedPaths.size;

    const downloadBtn = document.getElementById('batchDownloadBtn');
    downloadBtn.style.display = count > 0 ? '' : 'none';
    downloadBtn.title = count > 0 ? `下载选中的 ${count} 项` : '下载选中';

    const btn = document.getElementById('batchDeleteBtn');
    btn.style.display = count > 0 ? '' : 'none';
    btn.title = count > 0 ? `删除选中的 ${count} 项` : '删除选中';
}

// ===== Preview =====
// The renderer kind comes from the backend (/api/list -> item.preview) so the
// whitelist lives in exactly one place. Kinds: image, svg, html, pdf, video,
// audio, markdown, text.
const EDITABLE_KINDS = ['text', 'markdown'];

let previewState = null; // { path, name, kind, size, content, editing, truncated, loaded }

function openPreview(path, name, kind, size) {
    previewState = { path, name, kind, size: size || 0, content: null, editing: false, truncated: false, loaded: false };

    document.getElementById('previewTitle').textContent = name;
    document.getElementById('previewIcon').innerHTML = getFileIcon(name, false);
    document.getElementById('previewMeta').textContent = size ? formatSize(size) : '';
    // Text-like files only become editable once their content has actually
    // loaded: until the fetch reports whether the file was truncated, offering
    // an editor could invite a save that wipes everything past the limit.
    document.getElementById('previewEditBtn').style.display = 'none';
    document.getElementById('previewFooter').style.display = 'none';
    document.getElementById('previewModal').style.display = 'flex';

    renderPreviewBody();
}

function closePreview() {
    if (previewState && previewState.editing) {
        if (!confirm('有未保存的修改，确定关闭吗？')) return;
    }
    document.getElementById('previewModal').style.display = 'none';
    document.getElementById('previewBody').innerHTML = '';
    previewState = null;
}

function renderPreviewBody() {
    const body = document.getElementById('previewBody');
    body.innerHTML = '';
    if (!previewState) return;
    body.className = 'modal-body preview-body kind-' + previewState.kind;

    const url = `/api/preview?path=${encodeURIComponent(previewState.path)}`;

    switch (previewState.kind) {
        case 'image':
        case 'svg': {
            // SVG goes through <img> rather than an iframe or a top-level tab:
            // an image is a non-scripting context, so embedded script cannot run.
            const img = document.createElement('img');
            img.className = 'preview-image';
            img.src = url;
            img.alt = previewState.name;
            body.appendChild(img);
            break;
        }
        case 'video': {
            const v = document.createElement('video');
            v.className = 'preview-video';
            v.src = url;
            v.controls = true;
            v.preload = 'metadata';
            body.appendChild(v);
            break;
        }
        case 'audio': {
            const a = document.createElement('audio');
            a.className = 'preview-audio';
            a.src = url;
            a.controls = true;
            a.preload = 'metadata';
            body.appendChild(a);
            break;
        }
        case 'pdf':
        case 'html': {
            const frame = document.createElement('iframe');
            frame.className = 'preview-frame';
            frame.src = url;
            // Both types are served with a sandboxing CSP, so this attribute is
            // belt-and-braces for the case where the header is stripped by a proxy.
            frame.setAttribute('sandbox', '');
            body.appendChild(frame);
            break;
        }
        case 'markdown':
        case 'text':
        default:
            renderTextPreview(body);
            break;
    }
}

async function renderTextPreview(body) {
    // The body is re-rendered on every preview/edit toggle, so the content is
    // fetched once per open and reused; otherwise each toggle would pull the
    // whole file across the network again.
    if (previewState.content === null) {
        const loading = document.createElement('div');
        loading.className = 'preview-loading';
        loading.textContent = '加载中...';
        body.appendChild(loading);

        let loaded = '';
        try {
            // Preview is always the bounded first chunk: the backend reads at
            // most 1 MB and reports truncation, so opening a huge log stays
            // flat in memory. ?full=1 is only requested when the user actually
            // opens the editor (see toggleEdit).
            const data = await api(`/api/file?path=${encodeURIComponent(previewState.path)}`);
            loaded = (data.data && data.data.content) || '';
            previewState.truncated = !!(data.data && data.data.truncated);
            previewState.size = (data.data && data.data.size) || previewState.size;
        } catch (err) {
            // The modal may have been closed while the request was in flight.
            if (!previewState) return;
            body.innerHTML = '';
            const errEl = document.createElement('div');
            errEl.className = 'preview-error';
            errEl.textContent = '无法加载文件内容: ' + err.message;
            body.appendChild(errEl);
            return;
        }

        // Only commit the fetch result once it is in hand. Assigning earlier
        // would leave content non-null while this call is still suspended, so a
        // second render (a fast edit toggle) would skip the loading branch and
        // paint an empty body with no textarea in it.
        if (!previewState) return;
        previewState.content = loaded;
        previewState.loaded = true;
        // A prefix is not safe to edit, so the entry point stays hidden rather
        // than letting a save truncate the file to the loaded chunk.
        syncEditButton();
    }

    if (!previewState) return;
    body.innerHTML = '';

    if (previewState.kind === 'markdown') {
        if (previewState.truncated) {
            body.appendChild(buildTruncationNotice());
        }
        if (previewState.editing) {
            body.appendChild(buildTextarea(previewState.content));
        } else {
            const article = document.createElement('div');
            article.className = 'markdown-body';
            article.innerHTML = renderMarkdown(previewState.content);
            body.appendChild(article);
        }
        return;
    }

    if (previewState.truncated) {
        body.appendChild(buildTruncationNotice());
    }

    if (previewState.editing) {
        body.appendChild(buildTextarea(previewState.content));
    } else {
        const pre = document.createElement('pre');
        pre.className = 'preview-text';
        pre.textContent = previewState.content;
        body.appendChild(pre);
    }
}

// Mirrors textEditLimit on the backend. The editor loads the whole file so a
// save cannot drop the tail, and a full load costs about 4x the file size in
// peak memory, so the ceiling has to stay well under the container budget.
const EDIT_LIMIT = 32 * 1024 * 1024;

// syncEditButton is the single place that decides whether the edit entry point
// is reachable. It stays hidden while content is still loading, and hidden for
// files past EDIT_LIMIT, which the editor could not hold anyway.
function syncEditButton() {
    if (!previewState) return;
    const canEdit = EDITABLE_KINDS.includes(previewState.kind)
        && previewState.loaded
        && previewState.size <= EDIT_LIMIT;
    document.getElementById('previewEditBtn').style.display = canEdit ? '' : 'none';
}

// buildTruncationNotice explains why only part of a file is on screen. The
// wording differs by whether the editor can still load the whole file, so the
// user knows if editing is available before clicking anything.
function buildTruncationNotice() {
    const el = document.createElement('div');
    el.className = 'preview-truncated';
    const total = formatSize(previewState.size);
    if (previewState.size > EDIT_LIMIT) {
        el.textContent = '文件较大（' + total + '），仅预览前 1 MB。超过 32 MB 的文件不支持在线编辑，请下载后查看完整内容。';
    } else {
        el.textContent = '文件较大（' + total + '），仅预览前 1 MB。点击编辑可加载完整内容。';
    }
    return el;
}

function buildTextarea(value) {
    const ta = document.createElement('textarea');
    ta.className = 'editor-textarea';
    ta.id = 'editorTextarea';
    ta.value = value;
    return ta;
}

async function toggleEdit() {
    if (!previewState) return;
    if (previewState.editing) {
        closeEditMode();
        return;
    }

    // Refuse on size as well as hiding the button, so a keyboard shortcut or a
    // stale button state cannot reach the editor for a file it cannot hold.
    if (previewState.size > EDIT_LIMIT) {
        showToast('文件超过 32 MB，无法在线编辑，请下载后修改', 'error');
        return;
    }

    // The preview holds only the first 1 MB. Editing needs the whole file, so
    // fetch it here, on demand, rather than paying that cost on every open.
    if (previewState.truncated) {
        const btn = document.getElementById('previewEditBtn');
        btn.style.display = 'none';
        try {
            const data = await api(`/api/file?path=${encodeURIComponent(previewState.path)}&full=1`);
            if (!previewState) return;
            previewState.content = (data.data && data.data.content) || '';
            previewState.truncated = false;
        } catch (err) {
            if (!previewState) return;
            showToast('无法加载完整内容: ' + err.message, 'error');
            syncEditButton();
            return;
        }
    }

    previewState.editing = true;
    document.getElementById('previewEditBtn').style.display = 'none';
    document.getElementById('previewFooter').style.display = '';
    renderPreviewBody();
    const ta = document.getElementById('editorTextarea');
    if (ta) ta.focus();
}

function closeEditMode() {
    if (!previewState) return;
    previewState.editing = false;
    syncEditButton();
    document.getElementById('previewFooter').style.display = 'none';
    renderPreviewBody();
}

async function saveEdit() {
    if (!previewState || !previewState.editing) return;
    // Final guard on the destructive path: writing a prefix back to disk
    // would silently drop every byte past textPreviewLimit.
    if (previewState.truncated) {
        showToast('文件过大，仅预览了前 1 MB，无法保存', 'error');
        return;
    }
    const ta = document.getElementById('editorTextarea');
    if (!ta) return;

    // The full file path is split here rather than trusted from the listing:
    // the previous editor saved to the *current directory* plus the basename,
    // which reset the file whenever the name cell was clicked, because that
    // path was the directory itself.
    const fullPath = previewState.path;
    const dir = getParentPath(fullPath);
    const base = fullPath.split('/').pop();
    const content = ta.value;

    try {
        await api('/api/create-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dir, name: base, content })
        });
        previewState.content = content;
        previewState.editing = false;
        syncEditButton();
        document.getElementById('previewFooter').style.display = 'none';
        renderPreviewBody();
        showToast('保存成功');
        await loadFiles();
    } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
    }
}

// ===== Minimal Markdown renderer =====
// Deliberately dependency-free: the whole point of this project is one small
// binary. Source text is HTML-escaped *before* any markup is produced, so a
// document cannot inject elements; only the tags built below reach innerHTML.
function renderMarkdown(src) {
    const esc = function (s) {
        return s.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
    };

    const inline = function (s) {
        return esc(s)
            .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>')
            .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, text, href) {
                // Only schemes that cannot execute script become links. Anything
                // else (javascript:, data:, a relative path) is left as literal
                // text, so a document can never smuggle in an active URL.
                if (!/^(https?:|mailto:|#)/i.test(href)) return m;
                return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
            });
    };

    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let listType = null;

    const closeList = function () { if (listType) { out.push('</' + listType + '>'); listType = null; } };
    const openList = function (t) { if (listType !== t) { closeList(); out.push('<' + t + '>'); listType = t; } };

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block
        const fence = line.match(/^\s*\x60\x60\x60(.*)$/);
        if (fence) {
            closeList();
            const lang = fence[1].trim();
            const buf = [];
            i++;
            while (i < lines.length && !/^\s*\x60\x60\x60\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
            i++; // consume the closing fence
            out.push('<pre class="md-code"><code' +
                     (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' +
                     esc(buf.join('\n')) + '</code></pre>');
            continue;
        }

        // Blank line
        if (!line.trim()) { closeList(); i++; continue; }

        // Horizontal rule
        if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }

        // Heading
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            closeList();
            const n = h[1].length;
            out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>');
            i++;
            continue;
        }

        // Blockquote
        if (/^\s*>/.test(line)) {
            closeList();
            const buf = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) {
                buf.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
            continue;
        }

        // Table: a header row followed by a separator row
        if (/\|/.test(line) && i + 1 < lines.length &&
            /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
            closeList();
            const cells = function (row) {
                return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
                          .map(function (c) { return c.trim(); });
            };
            const head = cells(line);
            i += 2;
            const rows = [];
            while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
                rows.push(cells(lines[i]));
                i++;
            }
            let html = '<table class="md-table"><thead><tr>' +
                       head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
                       '</tr></thead><tbody>';
            html += rows.map(function (r) {
                return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
            }).join('');
            out.push(html + '</tbody></table>');
            continue;
        }

        // Unordered list
        const ul = line.match(/^\s*[-*+]\s+(.*)$/);
        if (ul) { openList('ul'); out.push('<li>' + inline(ul[1]) + '</li>'); i++; continue; }

        // Ordered list
        const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ol) { openList('ol'); out.push('<li>' + inline(ol[1]) + '</li>'); i++; continue; }

        // Paragraph: gather until a blank line or another block starter
        closeList();
        const buf = [line];
        i++;
        while (i < lines.length && lines[i].trim() &&
               !/^\s*(\x60\x60\x60|>|#{1,6}\s|[-*+]\s|\d+[.)]\s)/.test(lines[i])) {
            buf.push(lines[i]);
            i++;
        }
        out.push('<p>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</p>');
    }

    closeList();
    return out.join('\n');
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

    // Batch selection: the header box toggles only the rows on screen.
    document.getElementById('selectAllCheckbox').onchange = (e) => {
        const boxes = Array.from(document.querySelectorAll('.row-select'));
        boxes.forEach((cb) => {
            const fullPath = cb.dataset.path;
            cb.checked = e.target.checked;
            cb.closest('tr').classList.toggle('selected', e.target.checked);
            if (e.target.checked) selectedPaths.add(fullPath);
            else selectedPaths.delete(fullPath);
        });
        syncSelectionUi();
    };
    document.getElementById('batchDownloadBtn').onclick = downloadSelected;
    document.getElementById('batchDeleteBtn').onclick = deleteSelected;
    
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
    
    // Preview
    document.getElementById('previewCloseBtn').onclick = closePreview;
    document.getElementById('previewBackdrop').onclick = closePreview;
    document.getElementById('previewEditBtn').onclick = toggleEdit;
    document.getElementById('previewCancelEditBtn').onclick = closeEditMode;
    document.getElementById('previewSaveEditBtn').onclick = saveEdit;
    document.getElementById('previewOpenBtn').onclick = () => {
        if (previewState) openInNewTab(previewState.path, true);
    };
    document.getElementById('previewDownloadBtn').onclick = () => {
        if (previewState) downloadFile(previewState.path);
    };
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const modal = document.getElementById('previewModal');
        if (modal.style.display === 'none' || !previewState) return;
        if (previewState.editing) closeEditMode();
        else closePreview();
    });
    
    // Search
    let searchTimer = null;
    document.getElementById('searchInput').oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            currentPage = 1; // results are shown whole, start from the top
            renderTable();
        }, 200);
    };

    // Pagination
    document.getElementById('pageSizeSelect').onchange = (e) => {
        const size = parseInt(e.target.value, 10);
        if (!PAGE_SIZES.includes(size)) return;
        pageSize = size;
        currentPage = 1;
        renderTable();
    };
    document.getElementById('prevPageBtn').onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    };
    document.getElementById('nextPageBtn').onclick = () => {
        const totalPages = Math.max(1, Math.ceil(getVisibleFiles().length / pageSize));
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
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
            currentPage = 1; // re-sorted list starts at the first page
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
        if ((e.ctrlKey || e.metaKey) && e.key === 's' && previewState && previewState.editing && !previewState.truncated) {
            e.preventDefault();
            saveEdit();
            return;
        }
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => {
                // previewModal and uploadModal manage their own state; hiding
                // them here would drop the dirty-check and the upload list.
                if (m.style.display !== 'none' && m.id !== 'uploadModal' && m.id !== 'previewModal') {
                    m.style.display = 'none';
                }
            });
        }
    });
    
    // Initial load
    loadFiles();
});


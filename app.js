// ============================================================
// STATE
// ============================================================
const State = {
    gscData: null,      // Array from GSC CSV
    contentData: null,  // Array from Content Metrics CSV
    metaData: null,     // Array from Metadata CSV
    merged: [],         // Combined dataset
    charts: {},
    analysisObj: null
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('[INIT] App loaded');
    initTheme();
    setupTabs();
    setupThemeToggle();
    setupFileInputs();
});

// ============================================================
// THEME
// ============================================================
function initTheme() {
    if (localStorage.getItem('theme') === 'light') {
        document.documentElement.classList.add('light-mode');
        updateThemeIcon('light');
    }
}

function setupThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
        const isLight = document.documentElement.classList.toggle('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        updateThemeIcon(isLight ? 'light' : 'dark');
        if (State.merged.length > 0) analyzeData();
    });
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle i');
    if (!icon) return;
    icon.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun');
    lucide.createIcons();
}

// ============================================================
// TABS
// ============================================================
function setupTabs() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.classList.contains('disabled')) return;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            item.classList.add('active');
            document.getElementById(`tab-${item.dataset.tab}`).classList.add('active');
            if (item.dataset.tab !== 'home') renderChartsForTab(item.dataset.tab);
        });
    });
}

function enableTabs() {
    document.querySelectorAll('.nav-item.disabled').forEach(el => el.classList.remove('disabled'));
}

function updateStatus(text, cls) {
    document.getElementById('status-text').innerText = text;
    document.querySelector('.status-indicator').className = `status-indicator ${cls}`;
}

// ============================================================
// FILE INPUTS
// ============================================================
function setupFileInputs() {
    setupSingleInput('file-gsc', 'gsc');
    setupSingleInput('file-content', 'content');
    setupSingleInput('file-meta', 'meta');
}

function setupSingleInput(inputId, dataType) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', function(e) {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        console.log(`[FILE] ${dataType}:`, file.name, file.size);
        
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: function(results) {
                console.log(`[PAPA] ${dataType} parsed:`, results.data.length, 'rows');
                console.log(`[PAPA] ${dataType} headers:`, Object.keys(results.data[0] || {}));
                handleParsedCSV(dataType, results.data);
            },
            error: function(err) {
                console.error(`[PAPA] ${dataType} error:`, err);
                alert(`Error parsing ${dataType} CSV: ${err.message}`);
            }
        });
        this.value = null;
    });
}

function handleParsedCSV(type, data) {
    if (!data || data.length === 0) {
        alert('CSV appears empty.');
        return;
    }

    const statusEl = document.getElementById(`${type === 'gsc' ? 'gsc' : type === 'content' ? 'content' : 'meta'}-status`);
    const cardEl = document.getElementById(`upload-${type === 'gsc' ? 'gsc' : type}`);

    if (type === 'gsc') {
        State.gscData = data;
        statusEl.innerHTML = `<span style="color:var(--success)">✓ ${data.length} rows loaded</span>`;
    } else if (type === 'content') {
        State.contentData = data;
        statusEl.innerHTML = `<span style="color:var(--success)">✓ ${data.length} rows loaded</span>`;
    } else if (type === 'meta') {
        State.metaData = data;
        statusEl.innerHTML = `<span style="color:var(--success)">✓ ${data.length} rows loaded</span>`;
    }

    cardEl.style.borderColor = 'var(--success)';
    checkReadyToMerge();
}

function checkReadyToMerge() {
    // Show merge button as soon as at least the GSC data is loaded
    const mergeArea = document.getElementById('merge-area');
    if (State.gscData) {
        mergeArea.classList.remove('hidden');
        lucide.createIcons();
    }
    updateStatus('Data loaded', 'ready');
}

// ============================================================
// MERGE LOGIC
// ============================================================
function mergeAndAnalyze() {
    console.log('[MERGE] Starting merge...');
    
    if (!State.gscData) {
        alert('Please upload the Search Console CSV first.');
        return;
    }

    // --- 1. Parse GSC data ---
    const gscKeys = Object.keys(State.gscData[0]);
    const urlKey = gscKeys.find(k => k.toLowerCase().includes('page') || k.toLowerCase().includes('url') || k.toLowerCase().includes('key'));
    const clicksKey = gscKeys.find(k => k.toLowerCase().includes('click'));
    const impKey = gscKeys.find(k => k.toLowerCase().includes('impression'));
    const ctrKey = gscKeys.find(k => k.toLowerCase().includes('ctr'));
    const posKey = gscKeys.find(k => k.toLowerCase().includes('position'));

    if (!urlKey || !clicksKey) {
        alert('GSC CSV: cannot find URL or Clicks column.\nHeaders: ' + gscKeys.join(', '));
        return;
    }

    // Filter for /blog/ URLs and build base records
    const blogMap = {};
    State.gscData.forEach(row => {
        const url = row[urlKey];
        if (!url || typeof url !== 'string' || !url.includes('/blog/')) return;
        
        const cleanUrl = url.trim().replace(/\/$/, ''); // Normalise: trim & remove trailing slash
        blogMap[cleanUrl] = {
            url: cleanUrl,
            clicks: Number(row[clicksKey]) || 0,
            impressions: Number(row[impKey]) || 0,
            ctr: row[ctrKey] || 0,
            position: row[posKey] || 0,
            // Defaults for optional fields
            wordCount: 0,
            headingCount: 0,
            imageCount: 0,
            title: '',
            author: '',
            category: 'Uncategorized',
            publishDate: null
        };
    });

    console.log('[MERGE] GSC blogs:', Object.keys(blogMap).length);

    // --- 2. Merge Content Metrics ---
    if (State.contentData) {
        const cKeys = Object.keys(State.contentData[0]);
        const cUrlKey = cKeys.find(k => k.toLowerCase().includes('url'));
        const cWordKey = cKeys.find(k => k.toLowerCase().includes('word'));
        const cHeadKey = cKeys.find(k => k.toLowerCase().includes('heading'));
        const cImgKey = cKeys.find(k => k.toLowerCase().includes('image'));
        
        console.log('[MERGE] Content keys:', { cUrlKey, cWordKey, cHeadKey, cImgKey });
        
        if (cUrlKey) {
            let matched = 0;
            State.contentData.forEach(row => {
                const url = (row[cUrlKey] || '').trim().replace(/\/$/, '');
                if (blogMap[url]) {
                    blogMap[url].wordCount = Number(row[cWordKey]) || 0;
                    blogMap[url].headingCount = Number(row[cHeadKey]) || 0;
                    blogMap[url].imageCount = Number(row[cImgKey]) || 0;
                    matched++;
                }
            });
            console.log('[MERGE] Content matched:', matched, '/', State.contentData.length);
        }
    }

    // --- 3. Merge Metadata (join by Url Key slug) ---
    if (State.metaData) {
        const mKeys = Object.keys(State.metaData[0]);
        const mSlugKey = mKeys.find(k => k.toLowerCase().includes('url key') || k.toLowerCase().includes('urlkey') || k.toLowerCase().includes('url_key') || k.toLowerCase().includes('slug'));
        const mTitleKey = mKeys.find(k => k.toLowerCase().includes('title'));
        const mAuthorKey = mKeys.find(k => k.toLowerCase().includes('author'));
        const mCatKey = mKeys.find(k => k.toLowerCase().includes('categor'));
        const mDateKey = mKeys.find(k => k.toLowerCase().includes('published'));
        
        console.log('[MERGE] Meta keys:', { mSlugKey, mTitleKey, mAuthorKey, mCatKey, mDateKey });
        
        if (mSlugKey) {
            let matched = 0;
            State.metaData.forEach(row => {
                const slug = (row[mSlugKey] || '').trim();
                if (!slug) return;
                
                // Find matching blog by checking if URL ends with the slug
                const matchingUrl = Object.keys(blogMap).find(url => {
                    const urlPath = url.split('/').pop();
                    return urlPath === slug;
                });
                
                if (matchingUrl) {
                    const blog = blogMap[matchingUrl];
                    if (mTitleKey) blog.title = row[mTitleKey] || '';
                    if (mAuthorKey) blog.author = row[mAuthorKey] || '';
                    if (mCatKey) blog.category = row[mCatKey] || 'Uncategorized';
                    if (mDateKey && row[mDateKey]) {
                        const d = new Date(row[mDateKey]);
                        if (!isNaN(d.getTime())) blog.publishDate = d;
                    }
                    matched++;
                }
            });
            console.log('[MERGE] Meta matched:', matched, '/', State.metaData.length);
        }
    }

    // --- 4. Finalize ---
    State.merged = Object.values(blogMap);
    console.log('[MERGE] Final dataset:', State.merged.length, 'blogs');

    enableTabs();
    renderBlogList();
    analyzeData();
    updateStatus(`${State.merged.length} blogs merged`, 'ready');

    // Auto-switch to blog list
    document.querySelector('[data-tab="blogs"]').click();
}

// ============================================================
// BLOG LIST TAB
// ============================================================
function renderBlogList() {
    const tbody = document.getElementById('blog-list-body');
    tbody.innerHTML = State.merged
        .sort((a, b) => b.clicks - a.clicks)
        .map(b => {
            const shortUrl = b.url.length > 50 ? '…' + b.url.slice(-45) : b.url;
            const pubDate = b.publishDate ? b.publishDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
            return `<tr>
                <td>${b.title || '-'}</td>
                <td title="${b.url}" style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${shortUrl}</td>
                <td>${b.clicks}</td>
                <td>${b.impressions}</td>
                <td>${b.ctr}</td>
                <td>${typeof b.position === 'number' ? b.position.toFixed(1) : b.position}</td>
                <td>${b.wordCount || '-'}</td>
                <td>${b.headingCount || '-'}</td>
                <td>${b.imageCount || '-'}</td>
                <td>${b.author || '-'}</td>
                <td>${b.category}</td>
                <td>${pubDate}</td>
            </tr>`;
        }).join('');
}

// ============================================================
// DATA ANALYSIS & CHARTS
// ============================================================
function analyzeData() {
    const isLight = document.documentElement.classList.contains('light-mode');
    const labelColor = isLight ? '#64748b' : '#9ca3af';
    const gridColor = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayStats = {};
    for (let i = 0; i < 7; i++) dayStats[i] = { cl: 0, imp: 0, ct: 0 };
    const catStats = {};

    State.merged.forEach(item => {
        if (item.publishDate) {
            const d = new Date(item.publishDate);
            if (!isNaN(d.getTime())) {
                const day = d.getDay();
                dayStats[day].cl += item.clicks;
                dayStats[day].imp += item.impressions;
                dayStats[day].ct += 1;
            }
        }
        const cat = item.category || 'Uncategorized';
        if (!catStats[cat]) catStats[cat] = { cl: 0, imp: 0, ct: 0 };
        catStats[cat].cl += item.clicks;
        catStats[cat].imp += item.impressions;
        catStats[cat].ct += 1;
    });

    let bestDay = null, maxAvg = -1;
    for (let i = 0; i < 7; i++) {
        if (dayStats[i].ct > 0) {
            const avg = dayStats[i].cl / dayStats[i].ct;
            if (avg > maxAvg) { maxAvg = avg; bestDay = i; }
        }
    }
    if (bestDay !== null) document.getElementById('best-day').innerText = days[bestDay];
    document.getElementById('total-blogs-count').innerText = State.merged.length;

    State.analysisObj = { days, dayStats, catStats, labelColor, gridColor };
    buildAllCharts();
}

function buildAllCharts() {
    buildDateCharts();
    buildCategoryCharts();
    buildContentCharts();
}

function createChart(id, cfg) {
    if (State.charts[id]) State.charts[id].destroy();
    const canvas = document.getElementById(id);
    if (!canvas) return;
    Chart.defaults.color = State.analysisObj.labelColor;
    State.charts[id] = new Chart(canvas.getContext('2d'), cfg);
}

function buildDateCharts() {
    const { days, dayStats, gridColor } = State.analysisObj;
    createChart('chart-day-of-week', {
        type: 'bar',
        data: { labels: days, datasets: [{ label: 'Avg Clicks', data: days.map((_, i) => dayStats[i].ct > 0 ? (dayStats[i].cl / dayStats[i].ct).toFixed(1) : 0), backgroundColor: '#6366f1', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: gridColor } }, x: { grid: { display: false } } } }
    });

    const scatter = State.merged.filter(d => d.publishDate && d.clicks > 0).map(d => ({ x: new Date(d.publishDate), y: d.clicks }));
    createChart('chart-publish-date', {
        type: 'scatter',
        data: { datasets: [{ label: 'Posts', data: scatter, backgroundColor: '#8b5cf6', pointRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', time: { unit: 'month' }, grid: { color: gridColor } }, y: { title: { display: true, text: 'Clicks' }, grid: { color: gridColor } } } }
    });
}

function buildCategoryCharts() {
    const { catStats, gridColor } = State.analysisObj;
    const sorted = Object.keys(catStats)
        .map(c => ({ name: c, avgCl: (catStats[c].cl / catStats[c].ct).toFixed(1), avgImp: (catStats[c].imp / catStats[c].ct).toFixed(0), total: catStats[c].ct }))
        .sort((a, b) => b.avgCl - a.avgCl);

    createChart('chart-categories', {
        type: 'bar',
        data: { labels: sorted.map(c => c.name), datasets: [{ label: 'Avg Clicks', data: sorted.map(c => c.avgCl), backgroundColor: '#10b981', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: gridColor } }, x: { grid: { display: false } } } }
    });

    const tbody = document.querySelector('#category-table tbody');
    if (tbody) tbody.innerHTML = sorted.map(c => `<tr><td>${c.name}</td><td>${c.total}</td><td>${c.avgCl}</td><td>${c.avgImp}</td></tr>`).join('');
}

function buildContentCharts() {
    const { gridColor } = State.analysisObj;
    const valid = State.merged.filter(d => d.wordCount > 0);

    createChart('chart-wordcount', {
        type: 'scatter',
        data: { datasets: [{ label: 'WC vs Clicks', data: valid.map(d => ({ x: d.wordCount, y: d.clicks })), backgroundColor: '#6366f1', pointRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Word Count' }, grid: { color: gridColor } }, y: { title: { display: true, text: 'Clicks' }, grid: { color: gridColor } } } }
    });

    createChart('chart-images', {
        type: 'scatter',
        data: { datasets: [{ label: 'Images vs Clicks', data: valid.map(d => ({ x: d.imageCount, y: d.clicks })), backgroundColor: '#ef4444', pointRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Images' }, grid: { color: gridColor } }, y: { title: { display: true, text: 'Clicks' }, grid: { color: gridColor } } } }
    });

    const hg = { '0-5': { cl: 0, ct: 0 }, '6-10': { cl: 0, ct: 0 }, '11-15': { cl: 0, ct: 0 }, '16+': { cl: 0, ct: 0 } };
    valid.forEach(d => {
        const k = d.headingCount <= 5 ? '0-5' : d.headingCount <= 10 ? '6-10' : d.headingCount <= 15 ? '11-15' : '16+';
        hg[k].cl += d.clicks; hg[k].ct += 1;
    });
    createChart('chart-headings', {
        type: 'bar',
        data: { labels: Object.keys(hg), datasets: [{ label: 'Avg Clicks', data: Object.keys(hg).map(k => hg[k].ct > 0 ? (hg[k].cl / hg[k].ct).toFixed(1) : 0), backgroundColor: '#38bdf8', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: gridColor } }, x: { grid: { display: false } } } }
    });

    const top10 = [...valid].sort((a, b) => b.clicks - a.clicks).slice(0, Math.max(1, Math.floor(valid.length * 0.1)));
    if (top10.length > 0) {
        document.getElementById('avg-word-count-top').innerText = Math.round(top10.reduce((a, c) => a + c.wordCount, 0) / top10.length).toLocaleString();
        document.getElementById('avg-images-top').innerText = Math.round(top10.reduce((a, c) => a + c.imageCount, 0) / top10.length);
    }
}

function renderChartsForTab(tab) {
    setTimeout(() => {
        Object.values(State.charts).forEach(c => {
            if (c.canvas && c.canvas.closest(`#tab-${tab}`)) c.resize();
        });
    }, 50);
}

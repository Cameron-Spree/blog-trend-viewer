// ============================================================
// STATE
// ============================================================
const State = {
    allBlogs: [],       // All blog rows parsed from CSV (with GSC data)
    enhancedData: [],   // Blogs that have been crawled and enriched
    charts: {},
    isProcessing: false,
    analysisObj: null
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('[INIT] App loaded');
    initTheme();
    setupTabs();
    setupDropzone();
    setupFileInput();
    setupThemeToggle();
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
        if (State.enhancedData.length > 0) analyzeData();
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

function clearAllData() {
    location.reload();
}

// ============================================================
// FILE HANDLING
// ============================================================
function setupDropzone() {
    const dz = document.getElementById('dropzone');
    if (!dz) return;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    dz.addEventListener('click', () => document.getElementById('csv-file').click());
}

function setupFileInput() {
    const input = document.getElementById('csv-file');
    if (!input) return;
    input.addEventListener('change', function (e) {
        console.log('[FILE] change event, files:', e.target.files.length);
        if (e.target.files && e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
        this.value = null;
    });
}

function handleFile(file) {
    console.log('[FILE] handleFile:', file.name, file.size);
    if (!file.name.toLowerCase().endsWith('.csv')) {
        alert('Please upload a .csv file.');
        return;
    }
    updateStatus('Parsing CSV...', 'processing');

    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function (results) {
            console.log('[PAPA] Parsed rows:', results.data.length);
            processCSV(results.data);
        },
        error: function (err) {
            console.error('[PAPA] Error:', err);
            alert('CSV parse error: ' + err.message);
            updateStatus('Parse Error', '');
        }
    });
}

// ============================================================
// CSV → STAGING AREA
// ============================================================
function processCSV(data) {
    if (!data || data.length === 0) { alert('CSV is empty.'); return; }

    const keys = Object.keys(data[0]);
    console.log('[CSV] Headers:', keys);

    const urlKey = keys.find(k => k.toLowerCase().includes('page') || k.toLowerCase().includes('url') || k.toLowerCase().includes('key'));
    const clicksKey = keys.find(k => k.toLowerCase().includes('click'));
    const impKey = keys.find(k => k.toLowerCase().includes('impression'));

    if (!urlKey || !clicksKey) {
        alert('Could not find URL or Clicks columns.\nHeaders: ' + keys.join(', '));
        updateStatus('Bad CSV', '');
        return;
    }

    State.allBlogs = data
        .filter(r => r[urlKey] && typeof r[urlKey] === 'string' && r[urlKey].includes('/blog/'))
        .map(r => ({
            url: r[urlKey],
            clicks: r[clicksKey] || 0,
            impressions: r[impKey] || 0,
            ctr: r[keys.find(k => k.toLowerCase().includes('ctr'))] || 0,
            position: r[keys.find(k => k.toLowerCase().includes('position'))] || 0,
            status: 'pending'
        }));

    console.log('[CSV] Blog URLs:', State.allBlogs.length);

    if (State.allBlogs.length === 0) {
        alert('No URLs with /blog/ found.\nFirst URL: ' + (data[0][urlKey] || 'N/A'));
        updateStatus('No Blogs', '');
        return;
    }

    // Show staging area
    document.getElementById('dropzone').classList.add('hidden');
    const staging = document.getElementById('staging-area');
    staging.classList.remove('hidden');
    document.getElementById('staging-summary').innerText =
        `Found ${State.allBlogs.length} blog URLs in the CSV. Choose how many to process:`;
    const rowInput = document.getElementById('row-count');
    rowInput.max = State.allBlogs.length;
    rowInput.value = Math.min(10, State.allBlogs.length);
    document.getElementById('row-max-label').innerText = `(max ${State.allBlogs.length})`;

    updateStatus('CSV Loaded', 'ready');
    lucide.createIcons();
}

// ============================================================
// PROCESSING
// ============================================================
function startProcessing() {
    const count = parseInt(document.getElementById('row-count').value, 10);
    if (isNaN(count) || count < 1) { alert('Enter a valid number.'); return; }

    const toProcess = State.allBlogs.slice(0, count);
    console.log('[PROCESS] Will process', toProcess.length, 'URLs');

    // Hide staging, show progress
    document.getElementById('staging-area').classList.add('hidden');
    document.getElementById('processing-view').classList.remove('hidden');
    updateStatus('Scraping...', 'processing');

    // Populate blog list tab immediately with pending items
    State.enhancedData = [];
    toProcess.forEach(b => { b.status = 'pending'; });
    renderBlogList(toProcess);
    enableTabs();

    // Switch to blog list so user can watch live
    document.querySelector('[data-tab="blogs"]').click();

    // Start crawling
    crawlBatch(toProcess, 0);
}

async function crawlBatch(queue, startIdx) {
    State.isProcessing = true;
    const batchSize = 3;
    const total = queue.length;
    const progressFill = document.getElementById('crawl-progress');
    const progressText = document.getElementById('progress-text');
    let completed = 0;

    for (let i = 0; i < total; i += batchSize) {
        const batch = queue.slice(i, i + batchSize);
        console.log(`[CRAWL] Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} URLs`);

        await Promise.all(batch.map(async (item) => {
            try {
                const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(item.url)}`);
                const json = await resp.json();
                const metrics = parseHTML(json.contents);
                Object.assign(item, metrics);
                item.status = 'done';
            } catch (err) {
                console.warn('[CRAWL] Fail:', item.url, err.message);
                item.status = 'error';
                item.wordCount = 0; item.headingCount = 0; item.imageCount = 0; item.elementsCount = 0;
                item.h1Count = 0; item.h2Count = 0; item.h3Count = 0;
                item.publishDate = null; item.category = 'Uncategorized';
            } finally {
                completed++;
                progressFill.style.width = `${(completed / total) * 100}%`;
                progressText.innerText = `${completed} / ${total} URLs`;
            }
        }));

        // After each batch: update blog list live, rebuild charts
        State.enhancedData = queue.filter(b => b.status === 'done' || b.status === 'error');
        renderBlogList(queue);
        if (State.enhancedData.length > 0) {
            analyzeData();
        }
    }

    State.isProcessing = false;
    document.getElementById('processing-view').classList.add('hidden');
    updateStatus(`Done — ${completed} URLs`, 'ready');
    console.log('[DONE]', completed, 'URLs processed');
}

// ============================================================
// BLOG LIST TAB
// ============================================================
function renderBlogList(blogs) {
    const tbody = document.getElementById('blog-list-body');
    tbody.innerHTML = blogs.map(b => {
        const statusIcon = b.status === 'done'
            ? '<span style="color: var(--success);">✓</span>'
            : b.status === 'error'
                ? '<span style="color: var(--danger);">✗</span>'
                : '<span style="color: var(--text-muted);">⏳</span>';

        const shortUrl = b.url.length > 60 ? '…' + b.url.slice(-55) : b.url;
        const pubDate = b.publishDate ? new Date(b.publishDate).toLocaleDateString() : '-';

        return `<tr>
            <td>${statusIcon}</td>
            <td title="${b.url}" style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${shortUrl}</td>
            <td>${b.clicks}</td>
            <td>${b.impressions}</td>
            <td>${b.wordCount ?? '-'}</td>
            <td>${b.headingCount ?? '-'}</td>
            <td>${b.imageCount ?? '-'}</td>
            <td>${b.elementsCount ?? '-'}</td>
            <td>${b.category ?? '-'}</td>
            <td>${pubDate}</td>
        </tr>`;
    }).join('');
}

// ============================================================
// HTML PARSER
// ============================================================
function parseHTML(html) {
    if (!html) return { wordCount: 0, headingCount: 0, h1Count: 0, h2Count: 0, h3Count: 0, imageCount: 0, elementsCount: 0, publishDate: null, category: 'Uncategorized' };

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = doc.body?.innerText || doc.body?.textContent || '';
    const words = text.replace(/[\r\n\t]/g, ' ').split(' ').filter(w => w.trim().length > 0);

    const dateMeta = doc.querySelector('meta[property="article:published_time"]') || doc.querySelector('meta[name="date"]');
    const catMeta = doc.querySelector('meta[property="article:section"]');

    let publishDate = null;
    if (dateMeta && dateMeta.content) {
        const d = new Date(dateMeta.content);
        if (!isNaN(d.getTime())) publishDate = d;
    }

    return {
        wordCount: words.length,
        headingCount: doc.querySelectorAll('h1,h2,h3').length,
        h1Count: doc.querySelectorAll('h1').length,
        h2Count: doc.querySelectorAll('h2').length,
        h3Count: doc.querySelectorAll('h3').length,
        imageCount: doc.querySelectorAll('img').length,
        elementsCount: doc.querySelectorAll('*').length,
        publishDate,
        category: catMeta ? catMeta.content : 'Uncategorized'
    };
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
    for (let i = 0; i < 7; i++) dayStats[i] = { cl: 0, ct: 0 };
    const catStats = {};

    State.enhancedData.forEach(item => {
        if (item.publishDate) {
            const d = new Date(item.publishDate);
            if (!isNaN(d.getTime())) {
                const day = d.getDay();
                dayStats[day].cl += Number(item.clicks) || 0;
                dayStats[day].ct += 1;
            }
        }
        const cat = item.category || 'Uncategorized';
        if (!catStats[cat]) catStats[cat] = { cl: 0, ct: 0 };
        catStats[cat].cl += Number(item.clicks) || 0;
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
    document.getElementById('total-blogs-count').innerText = State.enhancedData.length;

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
        data: { labels: days, datasets: [{ label: 'Avg Clicks', data: days.map((_, i) => dayStats[i].ct > 0 ? dayStats[i].cl / dayStats[i].ct : 0), backgroundColor: '#6366f1', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: gridColor } }, x: { grid: { display: false } } } }
    });

    const scatter = State.enhancedData.filter(d => d.publishDate && d.clicks > 0).map(d => ({ x: new Date(d.publishDate), y: d.clicks }));
    createChart('chart-publish-date', {
        type: 'scatter',
        data: { datasets: [{ label: 'Posts', data: scatter, backgroundColor: '#8b5cf6' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', time: { unit: 'month' }, grid: { color: gridColor } }, y: { grid: { color: gridColor } } } }
    });
}

function buildCategoryCharts() {
    const { catStats, gridColor } = State.analysisObj;
    const sorted = Object.keys(catStats).map(c => ({ name: c, avg: (catStats[c].cl / catStats[c].ct).toFixed(2), total: catStats[c].ct })).sort((a, b) => b.avg - a.avg);

    createChart('chart-categories', {
        type: 'bar',
        data: { labels: sorted.map(c => c.name), datasets: [{ label: 'Avg Clicks', data: sorted.map(c => c.avg), backgroundColor: '#10b981', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: gridColor } }, x: { grid: { display: false } } } }
    });

    const tbody = document.querySelector('#category-table tbody');
    if (tbody) tbody.innerHTML = sorted.map(c => `<tr><td>${c.name}</td><td>${c.total}</td><td>${c.avg}</td><td>-</td></tr>`).join('');
}

function buildContentCharts() {
    const { gridColor } = State.analysisObj;
    const valid = State.enhancedData.filter(d => d.wordCount > 0);

    createChart('chart-wordcount', {
        type: 'scatter',
        data: { datasets: [{ label: 'WC vs Clicks', data: valid.map(d => ({ x: d.wordCount, y: d.clicks })), backgroundColor: '#6366f1' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Word Count' }, grid: { color: gridColor } }, y: { grid: { color: gridColor } } } }
    });

    createChart('chart-images', {
        type: 'scatter',
        data: { datasets: [{ label: 'Images vs Clicks', data: valid.map(d => ({ x: d.imageCount || 0, y: d.clicks })), backgroundColor: '#ef4444' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Images' }, grid: { color: gridColor } }, y: { grid: { color: gridColor } } } }
    });

    const hg = { '0-5': { cl: 0, ct: 0 }, '6-10': { cl: 0, ct: 0 }, '11-15': { cl: 0, ct: 0 }, '16+': { cl: 0, ct: 0 } };
    valid.forEach(d => {
        const hc = d.headingCount || 0;
        const k = hc <= 5 ? '0-5' : hc <= 10 ? '6-10' : hc <= 15 ? '11-15' : '16+';
        hg[k].cl += Number(d.clicks) || 0; hg[k].ct += 1;
    });

    createChart('chart-headings', {
        type: 'bar',
        data: { labels: Object.keys(hg), datasets: [{ label: 'Avg Clicks', data: Object.keys(hg).map(k => hg[k].ct > 0 ? hg[k].cl / hg[k].ct : 0), backgroundColor: '#38bdf8', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: gridColor } }, x: { grid: { display: false } } } }
    });

    const top10 = [...valid].sort((a, b) => b.clicks - a.clicks).slice(0, Math.max(1, Math.floor(valid.length * 0.1)));
    if (top10.length > 0) {
        document.getElementById('avg-word-count-top').innerText = Math.round(top10.reduce((a, c) => a + (c.wordCount || 0), 0) / top10.length).toLocaleString();
        document.getElementById('avg-images-top').innerText = Math.round(top10.reduce((a, c) => a + (c.imageCount || 0), 0) / top10.length);
    }
}

function renderChartsForTab(tab) {
    setTimeout(() => {
        Object.values(State.charts).forEach(c => {
            if (c.canvas && c.canvas.closest(`#tab-${tab}`)) c.resize();
        });
    }, 50);
}

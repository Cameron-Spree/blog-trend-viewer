// State Management
const State = {
    csvData: [],
    enhancedData: [], // Combination of CSV + Crawled data
    charts: {}, // Store chart instances to destroy/recreate them
    isProcessing: false,
    batchQueue: [], // URLs left to process
    completedCount: 0,
    totalToProcess: 0
};

// --- Initialization & UI Logic ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupTabs();
    setupDropzone();
    setupFileInput();
    setupThemeToggle();
    loadPersistedData();
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-mode');
        updateThemeIcon('light');
    }
}

function setupThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    toggle.addEventListener('click', () => {
        const isLight = document.documentElement.classList.toggle('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        updateThemeIcon(isLight ? 'light' : 'dark');
        
        // Redraw charts to update colors
        if (State.enhancedData.length > 0) {
            analyzeData();
        }
    });
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle i');
    icon.setAttribute('data-lucide', theme === 'light' ? 'moon' : 'sun');
    lucide.createIcons();
}

function loadPersistedData() {
    const savedData = localStorage.getItem('enhancedBlogData');
    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            // Rehydrate dates
            State.enhancedData = parsed.map(d => ({
                ...d,
                publishDate: d.publishDate ? new Date(d.publishDate) : null
            }));
            
            if (State.enhancedData.length > 0) {
                updateStatus("Loaded saved data", "ready");
                enableTabs();
                analyzeData();
            }
        } catch (e) {
            console.error("Failed to load saved data", e);
        }
    }
}

function clearAllData() {
    if(confirm("Are you sure you want to clear all data and start over?")) {
        localStorage.removeItem('enhancedBlogData');
        location.reload();
    }
}

function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (item.classList.contains('disabled')) return;

            navItems.forEach(nav => nav.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            item.classList.add('active');
            const targetId = `tab-${item.dataset.tab}`;
            document.getElementById(targetId).classList.add('active');
            
            if(item.dataset.tab !== 'home') {
                renderChartsForTab(item.dataset.tab);
            }
        });
    });
}

function enableTabs() {
    document.querySelectorAll('.nav-item.disabled').forEach(el => {
        el.classList.remove('disabled');
    });
}

function updateStatus(text, statusClass) {
    document.getElementById('status-text').innerText = text;
    const indicator = document.querySelector('.status-indicator');
    indicator.className = `status-indicator ${statusClass}`;
}

// --- File Handling ---
function setupDropzone() {
    const dropzone = document.getElementById('dropzone');
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });
    dropzone.addEventListener('click', () => document.getElementById('csv-file').click());
}

function setupFileInput() {
    document.getElementById('csv-file').addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });
}

function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
        alert("Please upload a valid CSV file.");
        return;
    }
    
    updateStatus("Parsing CSV...", "processing");
    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            processCSVData(results.data);
        }
    });
}

function processCSVData(data) {
    let urlKey, clicksKey, impressionsKey;

    if (data.length > 0) {
        const keys = Object.keys(data[0]);
        urlKey = keys.find(k => k.toLowerCase().includes('page') || k.toLowerCase().includes('url') || k.toLowerCase().includes('key'));
        clicksKey = keys.find(k => k.toLowerCase().includes('click'));
        impressionsKey = keys.find(k => k.toLowerCase().includes('impression'));
    }

    if (!urlKey || !clicksKey) {
        alert("Could not identify 'URL' or 'Clicks' columns.");
        updateStatus("Invalid CSV Structure", "");
        return;
    }

    // Filter and prepare queue
    const blogs = data.filter(row => {
        const url = row[urlKey];
        return url && typeof url === 'string' && url.includes('/blog/');
    }).map(row => ({
        url: row[urlKey],
        clicks: row[clicksKey] || 0,
        impressions: row[impressionsKey] || 0,
        ctr: row[Object.keys(row).find(k => k.toLowerCase().includes('ctr'))] || 0,
        position: row[Object.keys(row).find(k => k.toLowerCase().includes('position'))] || 0,
    }));

    if(blogs.length === 0) {
        alert("No blog URLs found.");
        updateStatus("No Blogs Found", "");
        return;
    }

    // Identify which ones we haven't crawled yet
    const existingUrls = new Set(State.enhancedData.map(d => d.url));
    State.batchQueue = blogs.filter(b => !existingUrls.has(b.url));
    
    if(State.batchQueue.length === 0) {
        alert("All blogs in this CSV have already been processed.");
        updateStatus("Data Updated", "ready");
        return;
    }

    startCrawling();
}

// --- Incremental Crawler ---
async function startCrawling() {
    if(State.isProcessing) return;
    State.isProcessing = true;
    
    document.getElementById('dropzone').classList.add('hidden');
    document.getElementById('processing-view').classList.remove('hidden');
    updateStatus("Scraping Blogs...", "processing");

    State.totalToProcess = State.batchQueue.length;
    State.completedCount = 0;
    
    const progressFill = document.getElementById('crawl-progress');
    const progressText = document.getElementById('progress-text');

    const batchSize = 5;
    
    while(State.batchQueue.length > 0) {
        const currentBatch = State.batchQueue.splice(0, batchSize);
        
        await Promise.all(currentBatch.map(async (item) => {
            try {
                const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(item.url)}`);
                const result = await response.json();
                const metrics = parseHTMLForMetrics(result.contents);
                State.enhancedData.push({ ...item, ...metrics });
            } catch (err) {
                State.enhancedData.push({ ...item, wordCount: 0, headingCount: 0 });
            } finally {
                State.completedCount++;
                const perc = (State.completedCount / State.totalToProcess) * 100;
                progressFill.style.width = `${perc}%`;
                progressText.innerText = `${State.completedCount} / ${State.totalToProcess} New URLs Processed`;
            }
        }));

        // Batch ready! Save and Notify
        saveData();
        showBatchPrompt();
    }

    finishCrawling();
}

function saveData() {
    localStorage.setItem('enhancedBlogData', JSON.stringify(State.enhancedData));
}

function showBatchPrompt() {
    // Only show the prompt if we are not on the Home tab (otherwise just update background)
    const activeTab = document.querySelector('.nav-item.active').dataset.tab;
    
    if (activeTab === 'home') {
        // Just enable tabs if first batch
        enableTabs();
        return;
    }

    if (document.getElementById('batch-toast')) return;

    const toast = document.createElement('div');
    toast.id = 'batch-toast';
    toast.className = 'notification-toast';
    toast.innerHTML = `
        <i data-lucide="zap"></i>
        <span>New batch of data analyzed!</span>
        <button onclick="refreshDashboardData()">Refresh Charts</button>
    `;
    document.getElementById('toast-container').appendChild(toast);
    lucide.createIcons();
}

function refreshDashboardData() {
    analyzeData();
    const activeTab = document.querySelector('.nav-item.active').dataset.tab;
    renderChartsForTab(activeTab);
    
    const toast = document.getElementById('batch-toast');
    if(toast) toast.remove();
}

function parseHTMLForMetrics(htmlString) {
    if (!htmlString) return {};
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const textContext = doc.body?.innerText || doc.body?.textContent || "";
    const words = textContext.replace(/[\r\n\t]/g, ' ').split(' ').filter(w => w.trim().length > 0);
    
    const dateMeta = doc.querySelector('meta[property="article:published_time"]') || doc.querySelector('meta[name="date"]');
    const sectionMeta = doc.querySelector('meta[property="article:section"]');

    return {
        wordCount: words.length,
        headingCount: doc.querySelectorAll('h1, h2, h3').length,
        h1Count: doc.querySelectorAll('h1').length,
        h2Count: doc.querySelectorAll('h2').length,
        h3Count: doc.querySelectorAll('h3').length,
        imageCount: doc.querySelectorAll('img').length,
        elementsCount: doc.querySelectorAll('*').length,
        publishDate: dateMeta ? new Date(dateMeta.content) : null,
        category: sectionMeta ? sectionMeta.content : "Uncategorized"
    };
}

function finishCrawling() {
    State.isProcessing = false;
    document.getElementById('processing-view').classList.add('hidden');
    updateStatus("All Data Synced", "ready");
    enableTabs();
    analyzeData();
}

// --- Data Analysis & Visualization ---
function analyzeData() {
    const isLight = document.documentElement.classList.contains('light-mode');
    const labelColor = isLight ? '#64748b' : '#9ca3af';
    const gridColor = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';

    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayStats = { 0: {cl:0, ct:0}, 1: {cl:0, ct:0}, 2: {cl:0, ct:0}, 3: {cl:0, ct:0}, 4: {cl:0, ct:0}, 5: {cl:0, ct:0}, 6: {cl:0, ct:0}};
    const catStats = {};
    
    State.enhancedData.forEach(item => {
        const dDate = new Date(item.publishDate);
        if(item.publishDate && !isNaN(dDate.getTime())) {
            const d = dDate.getDay();
            if (dayStats[d]) {
                dayStats[d].cl += Number(item.clicks) || 0;
                dayStats[d].ct += 1;
            }
        }
        const cat = item.category || "Uncategorized";
        if(!catStats[cat]) catStats[cat] = { cl: 0, ct: 0 };
        catStats[cat].cl += Number(item.clicks) || 0;
        catStats[cat].ct += 1;
    });

    let bestDayIdx = null, maxAvg = -1;
    for(let i=0; i<7; i++) {
        if(dayStats[i].ct > 0) {
            const avg = dayStats[i].cl / dayStats[i].ct;
            if(avg > maxAvg) { maxAvg = avg; bestDayIdx = i; }
        }
    }
    if (bestDayIdx !== null) document.getElementById('best-day').innerText = days[bestDayIdx];

    State.analysisObj = { days, dayStats, catStats, labelColor, gridColor };
    buildAllCharts();
}

function buildAllCharts() {
    buildDateCharts();
    buildCategoryCharts();
    buildContentCharts();
}

function createChart(canvasId, config) {
    if(State.charts[canvasId]) State.charts[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    Chart.defaults.color = State.analysisObj.labelColor;
    State.charts[canvasId] = new Chart(ctx, config);
}

function buildDateCharts() {
    const { days, dayStats, gridColor } = State.analysisObj;
    const dayAvgClicks = days.map((_, i) => dayStats[i].ct > 0 ? dayStats[i].cl / dayStats[i].ct : 0);

    createChart('chart-day-of-week', {
        type: 'bar',
        data: {
            labels: days,
            datasets: [{ label: 'Avg Clicks', data: dayAvgClicks, backgroundColor: '#6366f1', borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, grid: { color: gridColor } }, x: { grid: { display: false } } }
        }
    });

    const scatterData = State.enhancedData
        .filter(d => d.publishDate && d.clicks > 0)
        .map(d => ({ x: new Date(d.publishDate), y: d.clicks }));

    createChart('chart-publish-date', {
        type: 'scatter',
        data: { datasets: [{ label: 'Posts', data: scatterData, backgroundColor: '#8b5cf6' }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { type: 'time', time: { unit: 'month' }, grid: { color: gridColor } }, y: { grid: { color: gridColor } } }
        }
    });
}

function buildCategoryCharts() {
    const { catStats, gridColor } = State.analysisObj;
    const sortedCats = Object.keys(catStats).map(cat => ({
        name: cat,
        avg: (catStats[cat].cl / catStats[cat].ct).toFixed(2),
        total: catStats[cat].ct
    })).sort((a,b) => b.avg - a.avg);

    createChart('chart-categories', {
        type: 'bar',
        data: {
            labels: sortedCats.map(c => c.name),
            datasets: [{ label: 'Avg Clicks', data: sortedCats.map(c => c.avg), backgroundColor: '#10b981', borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: { color: gridColor } }, x: { grid: { display: false } } }
        }
    });

    const tbody = document.querySelector('#category-table tbody');
    tbody.innerHTML = sortedCats.map(cat => `<tr><td>${cat.name}</td><td>${cat.total}</td><td>${cat.avg}</td><td>-</td></tr>`).join('');
}

function buildContentCharts() {
    const { gridColor } = State.analysisObj;
    const validData = State.enhancedData.filter(d => d.wordCount > 0);
    
    createChart('chart-wordcount', {
        type: 'scatter',
        data: { datasets: [{ label: 'WC vs Clicks', data: validData.map(d => ({x:d.wordCount, y:d.clicks})), backgroundColor: '#6366f1' }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { title: { display: true, text: 'Word Count' }, grid: { color: gridColor } }, y: { grid: { color: gridColor } } }
        }
    });

    createChart('chart-images', {
        type: 'scatter',
        data: { datasets: [{ label: 'Images vs Clicks', data: validData.map(d => ({x:d.imageCount, y:d.clicks})), backgroundColor: '#ef4444' }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { title: { display: true, text: 'Images' }, grid: { color: gridColor } }, y: { grid: { color: gridColor } } }
        }
    });

    const hGroup = { '0-5': {cl:0, ct:0}, '6-10': {cl:0, ct:0}, '11-15': {cl:0, ct:0}, '16+': {cl:0, ct:0} };
    validData.forEach(d => {
        let k = d.headingCount <= 5 ? '0-5' : d.headingCount <= 10 ? '6-10' : d.headingCount <= 15 ? '11-15' : '16+';
        hGroup[k].cl += Number(d.clicks); hGroup[k].ct += 1;
    });

    createChart('chart-headings', {
        type: 'bar',
        data: {
            labels: Object.keys(hGroup),
            datasets: [{ label: 'Avg Clicks', data: Object.keys(hGroup).map(k => hGroup[k].ct > 0 ? hGroup[k].cl / hGroup[k].ct : 0), backgroundColor: '#38bdf8', borderRadius: 4 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: { color: gridColor } }, x: { grid: { display: false } } }
        }
    });

    const top10 = [...validData].sort((a,b) => b.clicks - a.clicks).slice(0, Math.max(1, Math.floor(validData.length * 0.1)));
    if(top10.length > 0) {
        document.getElementById('avg-word-count-top').innerText = Math.round(top10.reduce((a,c) => a + c.wordCount, 0) / top10.length).toLocaleString();
        document.getElementById('avg-images-top').innerText = Math.round(top10.reduce((a,c) => a + c.imageCount, 0) / top10.length);
    }
}

function renderChartsForTab(tabName) {
    setTimeout(() => {
        Object.values(State.charts).forEach(chart => {
            if(chart.canvas.closest(`#tab-${tabName}`)) chart.resize();
        });
    }, 50);
}

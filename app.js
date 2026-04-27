// State Management
const State = {
    csvData: [],
    enhancedData: [], // Combination of CSV + Crawled data
    charts: {}, // Store chart instances to destroy/recreate them
    isProcessing: false
};

// --- Initialization & UI Logic ---
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupDropzone();
    setupFileInput();
});

function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (item.classList.contains('disabled')) return;

            // Remove active from all
            navItems.forEach(nav => nav.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            // Set active to clicked
            item.classList.add('active');
            const targetId = `tab-${item.dataset.tab}`;
            document.getElementById(targetId).classList.add('active');
            
            // Re-render charts to fix responsive sizing bugs in Chart.js
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

// --- File Handling & PapaParse ---
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
    dropzone.addEventListener('click', () => {
        document.getElementById('csv-file').click();
    });
}

function setupFileInput() {
    document.getElementById('csv-file').addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });
}

function handleFile(file) {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
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
    // Attempt to dynamically find the URL, Clicks, Impressions columns
    // GSC usually has 'Top pages' for URLs, or 'Keys', or 'URL'
    let urlKey = null;
    let clicksKey = null;
    let impressionsKey = null;

    if (data.length > 0) {
        const keys = Object.keys(data[0]);
        urlKey = keys.find(k => k.toLowerCase().includes('page') || k.toLowerCase().includes('url') || k.toLowerCase().includes('key'));
        clicksKey = keys.find(k => k.toLowerCase().includes('click'));
        impressionsKey = keys.find(k => k.toLowerCase().includes('impression'));
    }

    if (!urlKey || !clicksKey) {
        alert("Could not identify 'URL' or 'Clicks' columns in the CSV. Please ensure it's a valid GSC export.");
        updateStatus("Invalid CSV Structure", "");
        return;
    }

    // Filter to only include URLs with /blog/
    State.csvData = data.filter(row => {
        const url = row[urlKey];
        return url && typeof url === 'string' && url.includes('/blog/');
    }).map(row => ({
        url: row[urlKey],
        clicks: row[clicksKey] || 0,
        impressions: row[impressionsKey] || 0,
        ctr: row[Object.keys(row).find(k => k.toLowerCase().includes('ctr'))] || 0,
        position: row[Object.keys(row).find(k => k.toLowerCase().includes('position'))] || 0,
    }));

    if(State.csvData.length === 0) {
        alert("No URLs containing '/blog/' found in the CSV.");
        updateStatus("No Blogs Found", "");
        return;
    }

    startCrawling();
}

// --- Crawler Logic using allorigins CORS proxy ---
async function startCrawling() {
    State.isProcessing = true;
    document.getElementById('dropzone').classList.add('hidden');
    document.getElementById('processing-view').classList.remove('hidden');
    updateStatus("Scraping Blogs...", "processing");

    const total = State.csvData.length;
    let completed = 0;
    
    const progressFill = document.getElementById('crawl-progress');
    const progressText = document.getElementById('progress-text');

    State.enhancedData = [];

    // Process in small batches to not overwhelm the proxy
    const batchSize = 3;
    for(let i = 0; i < total; i += batchSize) {
        const batch = State.csvData.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (item) => {
            try {
                // allorigins proxy
                const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(item.url)}`);
                const result = await response.json();
                
                const metrics = parseHTMLForMetrics(result.contents);
                
                State.enhancedData.push({
                    ...item,
                    ...metrics
                });
            } catch (err) {
                console.error(`Failed to fetch ${item.url}`, err);
                // Keep the item but with null metrics
                State.enhancedData.push({ ...item, wordCount: null, headings: 0 });
            } finally {
                completed++;
                progressFill.style.width = `${(completed / total) * 100}%`;
                progressText.innerText = `${completed} / ${total} URLs Processed`;
            }
        }));
    }

    finishCrawling();
}

function parseHTMLForMetrics(htmlString) {
    if (!htmlString) return {};
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // 1. Content Length (Word count in body)
    const textContext = doc.body?.innerText || doc.body?.textContent || "";
    // Clean string and split by whitespace
    const words = textContext.replace(/[\r\n\t]/g, ' ').split(' ').filter(w => w.trim().length > 0);
    const wordCount = words.length;

    // 2. Headings & Images
    const h1Count = doc.querySelectorAll('h1').length;
    const h2Count = doc.querySelectorAll('h2').length;
    const h3Count = doc.querySelectorAll('h3').length;
    const imageCount = doc.querySelectorAll('img').length;
    const elementsCount = doc.querySelectorAll('*').length;

    // 3. Publish Date (try common meta tags)
    let publishDate = null;
    const dateMeta = doc.querySelector('meta[property="article:published_time"]') || 
                     doc.querySelector('meta[name="date"]');
    if (dateMeta) {
        publishDate = new Date(dateMeta.content);
    }
    
    // 4. Category
    // Usually defined in article:section or looking at URL structure
    let category = "Uncategorized";
    const sectionMeta = doc.querySelector('meta[property="article:section"]');
    if (sectionMeta) {
        category = sectionMeta.content;
    }

    return {
        wordCount,
        headingCount: h1Count + h2Count + h3Count,
        h1Count,
        h2Count,
        h3Count,
        imageCount,
        elementsCount,
        publishDate: publishDate instanceof Date && !isNaN(publishDate) ? publishDate : null,
        category
    };
}

function finishCrawling() {
    State.isProcessing = false;
    document.getElementById('processing-view').classList.add('hidden');
    updateStatus("Analysis Complete", "ready");
    
    // Convert dates and build analysis
    analyzeData();
    enableTabs();
    
    // Auto-switch to Date tab
    document.querySelector('[data-tab="date"]').click();
}

// --- Data Analysis & Visualization ---
function analyzeData() {
    console.log("Enhanced Data:", State.enhancedData);
    
    // Build Day of Week average performance
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayStats = { 0: {clicks:0, imp:0, count:0}, 1: {clicks:0, imp:0, count:0}, 2: {clicks:0, imp:0, count:0}, 3: {clicks:0, imp:0, count:0}, 4: {clicks:0, imp:0, count:0}, 5: {clicks:0, imp:0, count:0}, 6: {clicks:0, imp:0, count:0}};
    
    // Category mapping
    const catStats = {};
    
    State.enhancedData.forEach(item => {
        if(item.publishDate) {
            const d = item.publishDate.getDay();
            dayStats[d].clicks += Number(item.clicks) || 0;
            dayStats[d].imp += Number(item.impressions) || 0;
            dayStats[d].count += 1;
        }

        const cat = item.category || "Uncategorized";
        if(!catStats[cat]) catStats[cat] = { clicks: 0, imp: 0, count: 0 };
        catStats[cat].clicks += Number(item.clicks) || 0;
        catStats[cat].imp += Number(item.impressions) || 0;
        catStats[cat].count += 1;
    });

    // Best day logic
    let bestDayIdx = null;
    let maxAvgClicks = -1;
    for(let i=0; i<7; i++) {
        if(dayStats[i].count > 0) {
            const avg = dayStats[i].clicks / dayStats[i].count;
            if(avg > maxAvgClicks) {
                maxAvgClicks = avg;
                bestDayIdx = i;
            }
        }
    }
    if (bestDayIdx !== null) {
        document.getElementById('best-day').innerText = days[bestDayIdx];
    }

    // Chart configs
    State.analysisObj = { days, dayStats, catStats };
    buildDateCharts();
    buildCategoryCharts();
    buildContentCharts();
}

function createChart(canvasId, config) {
    if(State.charts[canvasId]) {
        State.charts[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    // Apply global styling defaults
    Chart.defaults.color = '#9ca3af';
    Chart.defaults.font.family = 'Inter';
    
    State.charts[canvasId] = new Chart(ctx, config);
}

function renderChartsForTab(tabName) {
    // Fix resize loop by triggering updates after container shows
    setTimeout(() => {
        Object.values(State.charts).forEach(chart => {
            if(chart.canvas.closest(`#tab-${tabName}`)) {
                chart.resize();
            }
        });
    }, 50);
}

// ---------------- CHART BUILDERS ---------------- //

function buildDateCharts() {
    const { days, dayStats } = State.analysisObj;
    
    // Day of the Week Chart
    const dayLabels = [];
    const dayAvgClicks = [];
    for(let i=0; i<7; i++) {
        dayLabels.push(days[i]);
        if(dayStats[i].count > 0) {
            dayAvgClicks.push(dayStats[i].clicks / dayStats[i].count);
        } else {
            dayAvgClicks.push(0);
        }
    }

    createChart('chart-day-of-week', {
        type: 'bar',
        data: {
            labels: dayLabels,
            datasets: [{
                label: 'Avg Clicks',
                data: dayAvgClicks,
                backgroundColor: 'rgba(99, 102, 241, 0.7)',
                borderColor: 'rgba(99, 102, 241, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }
        }
    });

    // Scatter logic for Post Date vs Performance
    const scatterData = State.enhancedData
        .filter(d => d.publishDate && d.clicks > 0)
        .map(d => ({
            x: d.publishDate,
            y: d.clicks,
            url: d.url
        }));

    createChart('chart-publish-date', {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Posts',
                data: scatterData,
                backgroundColor: 'rgba(139, 92, 246, 0.7)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    type: 'time', 
                    time: { unit: 'month' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: { grid: { color: 'rgba(255,255,255,0.05)' } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => `Clicks: ${ctx.raw.y} - ${new URL(ctx.raw.url).pathname}`
                    }
                }
            }
        }
    });
}

function buildCategoryCharts() {
    const { catStats } = State.analysisObj;
    
    // Sort categories by Avg Clicks
    const sortedCats = Object.keys(catStats).map(cat => ({
        name: cat,
        count: catStats[cat].count,
        clicks: catStats[cat].clicks,
        imp: catStats[cat].imp,
        avgClicks: (catStats[cat].clicks / catStats[cat].count).toFixed(2),
        avgImp: (catStats[cat].imp / catStats[cat].count).toFixed(2)
    })).sort((a,b) => b.avgClicks - a.avgClicks);

    // Chart mapping
    createChart('chart-categories', {
        type: 'bar',
        data: {
            labels: sortedCats.map(c => c.name),
            datasets: [{
                label: 'Avg Clicks',
                data: sortedCats.map(c => c.avgClicks),
                backgroundColor: 'rgba(16, 185, 129, 0.7)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }
        }
    });

    // Populate Table
    const tbody = document.querySelector('#category-table tbody');
    tbody.innerHTML = '';
    sortedCats.forEach(cat => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${cat.name}</td>
            <td>${cat.count}</td>
            <td>${cat.avgClicks}</td>
            <td>${cat.avgImp}</td>
        `;
        tbody.appendChild(tr);
    });
}

function buildContentCharts() {
    const validData = State.enhancedData.filter(d => d.wordCount > 0);
    
    // Word Count vs Clicks Scatter
    const wordCountScatter = validData.map(d => ({
        x: d.wordCount,
        y: d.clicks,
        url: d.url
    }));

    createChart('chart-wordcount', {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Word Count vs Clicks',
                data: wordCountScatter,
                backgroundColor: 'rgba(99, 102, 241, 0.8)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Word Count' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { title: { display: true, text: 'Clicks' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });

    // Images vs Clicks
    const imagesScatter = validData.map(d => ({
        x: d.imageCount,
        y: d.clicks
    }));

    createChart('chart-images', {
        type: 'line', // Will use bubble or scatter
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Images vs Clicks',
                data: imagesScatter,
                backgroundColor: 'rgba(239, 68, 68, 0.7)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Number of Images' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });

    // Heading Breakdown Bar Chart
    const headingsData = validData.map(d => ({
        lbl: String(d.headingCount),
        y: d.clicks
    })).sort((a,b) => Number(a.lbl) - Number(b.lbl));

    // Grouping headings count to find average clicks per grouping (0-5, 6-10, 11-15, 16+)
    const hGroup = { '0-5': {cl:0, ct:0}, '6-10': {cl:0, ct:0}, '11-15': {cl:0, ct:0}, '16+': {cl:0, ct:0} };
    validData.forEach(d => {
        let key = '16+';
        if(d.headingCount <= 5) key = '0-5';
        else if (d.headingCount <= 10) key = '6-10';
        else if (d.headingCount <= 15) key = '11-15';
        hGroup[key].cl += Number(d.clicks);
        hGroup[key].ct += 1;
    });

    createChart('chart-headings', {
        type: 'bar',
        data: {
            labels: Object.keys(hGroup),
            datasets: [{
                label: 'Avg Clicks by Headings Count',
                data: Object.keys(hGroup).map(k => hGroup[k].ct > 0 ? hGroup[k].cl / hGroup[k].ct : 0),
                backgroundColor: 'rgba(56, 189, 248, 0.7)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }
        }
    });

    // Top 10% stats
    const top10Index = Math.max(1, Math.floor(validData.length * 0.1));
    const top10 = [...validData].sort((a,b) => b.clicks - a.clicks).slice(0, top10Index);
    
    if(top10.length > 0) {
        const avgWordCount = top10.reduce((acc, curr) => acc + curr.wordCount, 0) / top10.length;
        const avgImg = top10.reduce((acc, curr) => acc + curr.imageCount, 0) / top10.length;
        
        document.getElementById('avg-word-count-top').innerText = Math.round(avgWordCount).toLocaleString();
        document.getElementById('avg-images-top').innerText = Math.round(avgImg);
    }
}

// ============================================================
// STATE
// ============================================================
const State = {
    gscData: null,
    contentData: null,
    metaData: null,
    ga4EngData: null,
    ga4EcomData: null,
    merged: [],
    charts: {},
    analysisObj: null,
    activeMetrics: ['clicks'],
    sortConfig: { column: 'clicks', asc: false },
    searchQuery: ''
};

const metricPalette = {
    clicks: '#6366f1',
    impressions: '#10b981',
    ctr: '#38bdf8',
    position: '#f59e0b'
};

const metricLabels = {
    clicks: 'Clicks',
    impressions: 'Impressions',
    ctr: 'CTR',
    position: 'Position'
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
    setupTableControls();
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
    if(typeof lucide !== 'undefined') lucide.createIcons();
}

// ============================================================
// TABS & TOGGLES
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
    document.getElementById('global-metrics').classList.remove('hidden');
}

function updateStatus(text, cls) {
    document.getElementById('status-text').innerText = text;
    document.querySelector('.status-indicator').className = `status-indicator ${cls}`;
}

function toggleMetric(metric) {
    if (State.activeMetrics.includes(metric)) {
        if (State.activeMetrics.length === 1) return; // Prevent un-toggling everything
        State.activeMetrics = State.activeMetrics.filter(m => m !== metric);
    } else {
        State.activeMetrics.push(metric);
    }
    
    document.querySelectorAll('.metric-toggle').forEach(el => {
        if (State.activeMetrics.includes(el.dataset.metric)) el.classList.add('active');
        else el.classList.remove('active');
    });

    if (State.merged.length > 0) buildAllCharts();
}

// ============================================================
// FILE INPUTS
// ============================================================
function setupFileInputs() {
    setupSingleInput('file-gsc', 'gsc');
    setupSingleInput('file-content', 'content');
    setupSingleInput('file-meta', 'meta');
    setupSingleInput('file-ga4-eng', 'ga4-eng');
    setupSingleInput('file-ga4-ecom', 'ga4-ecom');
}

function setupSingleInput(inputId, dataType) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', function(e) {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: function(results) {
                handleParsedCSV(dataType, results.data);
            },
            error: function(err) {
                alert(`Error parsing ${dataType} CSV: ${err.message}`);
            }
        });
        this.value = null;
    });
}

function handleParsedCSV(type, data) {
    if (!data || data.length === 0) return;

    const baseType = type.startsWith('ga4') ? type : type === 'gsc' ? 'gsc' : type === 'content' ? 'content' : 'meta';
    
    const statusEl = document.getElementById(`${baseType}-status`);
    const cardEl = document.getElementById(`upload-${baseType}`);

    if (type === 'gsc') State.gscData = data;
    else if (type === 'content') State.contentData = data;
    else if (type === 'meta') State.metaData = data;
    else if (type === 'ga4-eng') State.ga4EngData = data;
    else if (type === 'ga4-ecom') State.ga4EcomData = data;

    if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">✓ ${data.length} rows loaded</span>`;
    if (cardEl) cardEl.style.borderColor = 'var(--success)';
    checkReadyToMerge();
}

function checkReadyToMerge() {
    if (State.gscData) {
        document.getElementById('merge-area').classList.remove('hidden');
        if(typeof lucide !== 'undefined') lucide.createIcons();
    }
    updateStatus('Data loaded', 'ready');
}

// ============================================================
// MERGE LOGIC
// ============================================================
function mergeAndAnalyze() {
    try {
        if (!State.gscData) {
            alert('Please upload the Search Console CSV first.');
            return;
        }

        const gscKeys = Object.keys(State.gscData[0]);
        const urlKey = gscKeys.find(k => k.toLowerCase().includes('page') || k.toLowerCase().includes('url') || k.toLowerCase().includes('key'));
        const clicksKey = gscKeys.find(k => k.toLowerCase().includes('click'));
        const impKey = gscKeys.find(k => k.toLowerCase().includes('impression'));
        const ctrKey = gscKeys.find(k => k.toLowerCase().includes('ctr'));
        const posKey = gscKeys.find(k => k.toLowerCase().includes('position'));

        if (!urlKey || !clicksKey) {
            alert('Cannot find URL or Clicks column in GSC CSV.');
            return;
        }

        let gscRows = State.gscData.filter(row => row[urlKey] && typeof row[urlKey] === 'string' && row[urlKey].includes('/blog/'));
        if (gscRows.length === 0) gscRows = State.gscData.filter(row => row[urlKey] && typeof row[urlKey] === 'string');

        const blogMap = {};
        gscRows.forEach(row => {
            const cleanUrl = row[urlKey].trim().replace(/\/$/, '');
            let parsedCtr = row[ctrKey] || 0;
            if (typeof parsedCtr === "string") parsedCtr = parseFloat(parsedCtr.replace("%", ""));
            
            blogMap[cleanUrl] = {
                url: cleanUrl,
                clicks: Number(row[clicksKey]) || 0,
                impressions: Number(row[impKey]) || 0,
                ctr: parsedCtr,
                position: Number(row[posKey]) || 0,
                wordCount: 0,
                headingCount: 0,
                imageCount: 0,
                title: '',
                author: '',
                category: 'Uncategorized',
                publishDate: null,
                engagementRate: 0,
                avgTime: 0,
                conversions: 0,
                revenue: 0,
                internalLinks: 0,
                ageInDays: 0
            };
        });

        // Content Merge
        if (State.contentData && State.contentData.length > 0) {
            const cKeys = Object.keys(State.contentData[0]);
            const cUrlKey = cKeys.find(k => k.toLowerCase().includes('url'));
            const cWordKey = cKeys.find(k => k.toLowerCase().includes('word'));
            const cHeadKey = cKeys.find(k => k.toLowerCase().includes('heading'));
            const cImgKey = cKeys.find(k => k.toLowerCase().includes('image'));
            const cLinkKey = cKeys.find(k => k.toLowerCase().includes('link') || k.toLowerCase().includes('internal'));
            
            if (cUrlKey) {
                State.contentData.forEach(row => {
                    const url = (row[cUrlKey] || '').toString().trim().replace(/\/$/, '');
                    if (blogMap[url]) {
                        if (cWordKey) blogMap[url].wordCount = Number(row[cWordKey]) || 0;
                        if (cHeadKey) blogMap[url].headingCount = Number(row[cHeadKey]) || 0;
                        if (cImgKey) blogMap[url].imageCount = Number(row[cImgKey]) || 0;
                        if (cLinkKey) blogMap[url].internalLinks = Number(row[cLinkKey]) || 0;
                    }
                });
            }
        }

        // Meta Merge
        if (State.metaData && State.metaData.length > 0) {
            const mKeys = Object.keys(State.metaData[0]);
            const mSlugKey = mKeys.find(k => {
                const lk = k.toLowerCase().trim();
                return lk.includes('url key') || lk.includes('urlkey') || lk.includes('url_key') || lk === 'slug' || lk === 'url key';
            });
            const mTitleKey = mKeys.find(k => k.toLowerCase().includes('title'));
            const mAuthorKey = mKeys.find(k => k.toLowerCase().includes('author'));
            const mCatKey = mKeys.find(k => k.toLowerCase().includes('categor'));
            const mDateKey = mKeys.find(k => k.toLowerCase().includes('published'));
            
            if (mSlugKey) {
                State.metaData.forEach(row => {
                    const slug = (row[mSlugKey] || '').toString().trim();
                    if (!slug) return;
                    
                    const matchingUrl = Object.keys(blogMap).find(url => {
                        const urlSlug = url.split('/').filter(Boolean).pop();
                        return urlSlug === slug;
                    });
                    
                    if (matchingUrl) {
                        const blog = blogMap[matchingUrl];
                        if (mTitleKey) blog.title = row[mTitleKey] || '';
                        if (mAuthorKey) blog.author = row[mAuthorKey] || '';
                        if (mCatKey) blog.category = row[mCatKey] || 'Uncategorized';
                        if (mDateKey && row[mDateKey]) {
                            const d = new Date(row[mDateKey]);
                            if (!isNaN(d.getTime())) {
                                blog.publishDate = d;
                                const diffTime = Math.abs(new Date() - d);
                                blog.ageInDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            }
                        }
                    }
                });
            }
        }

        // GA4 Engagement Merge
        if (State.ga4EngData && State.ga4EngData.length > 0) {
            const g4Keys = Object.keys(State.ga4EngData[0]);
            const g4UrlKey = g4Keys.find(k => k.toLowerCase().includes('page') || k.toLowerCase().includes('url') || k.toLowerCase().includes('path'));
            const engKey = g4Keys.find(k => k.toLowerCase().includes('engagement rate'));
            const timeKey = g4Keys.find(k => k.toLowerCase().includes('time') || k.toLowerCase().includes('duration'));

            if (g4UrlKey) {
                State.ga4EngData.forEach(row => {
                    let path = (row[g4UrlKey] || '').toString().trim();
                    const slug = path.split('/').filter(Boolean).pop();
                    if (!slug) return;

                    const matchingUrl = Object.keys(blogMap).find(url => {
                        const urlSlug = url.split('/').filter(Boolean).pop();
                        return urlSlug === slug;
                    });

                    if (matchingUrl) {
                        const blog = blogMap[matchingUrl];
                        if (engKey) {
                           let eng = row[engKey] || 0;
                           if (typeof eng === "string") eng = parseFloat(eng.replace("%", ""));
                           blog.engagementRate = eng || 0;
                        }
                        if (timeKey) blog.avgTime = Number(row[timeKey]) || 0;
                    }
                });
            }
        }

        // GA4 E-commerce Merge
        if (State.ga4EcomData && State.ga4EcomData.length > 0) {
            const g4Keys = Object.keys(State.ga4EcomData[0]);
            const g4RefKey = g4Keys.find(k => k.toLowerCase().includes('referrer') || k.toLowerCase().includes('page'));
            const revKey = g4Keys.find(k => k.toLowerCase().includes('revenue'));
            const purchKey = g4Keys.find(k => k.toLowerCase().includes('purchased') || k.toLowerCase().includes('conversion'));

            if (g4RefKey) {
                State.ga4EcomData.forEach(row => {
                    let ref = (row[g4RefKey] || '').toString().trim();
                    const slug = ref.split('/').filter(Boolean).pop();
                    if (!slug) return;

                    const matchingUrl = Object.keys(blogMap).find(url => {
                        const urlSlug = url.split('/').filter(Boolean).pop();
                        return urlSlug === slug;
                    });

                    if (matchingUrl) {
                        const blog = blogMap[matchingUrl];
                        if (purchKey) {
                            let purch = row[purchKey] || 0;
                            if (typeof purch === 'string') purch = parseFloat(purch.replace(/[^0-9.-]+/g,""));
                            blog.conversions += (purch || 0); // Accumulate if multiple items per referring blog
                        }
                        if (revKey) {
                           let rev = row[revKey] || 0;
                           if (typeof rev === "string") rev = parseFloat(rev.replace(/[^0-9.-]+/g,""));
                           blog.revenue += (rev || 0); // Accumulate item revenue
                        }
                    }
                });
            }
        }

        State.merged = Object.values(blogMap);
        if (State.merged.length === 0) {
            alert('Merge produced 0 results.');
            return;
        }

        enableTabs();
        analyzeData();
        renderBlogList();
        updateStatus(`${State.merged.length} blogs active`, 'ready');

        document.querySelector('[data-tab="blogs"]').click();
        
    } catch (err) {
        console.error(err);
        alert('Merge error: ' + err.message);
    }
}

// ============================================================
// BLOG LIST UI
// ============================================================
function setupTableControls() {
    const searchInput = document.getElementById('blog-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            State.searchQuery = e.target.value.toLowerCase();
            renderBlogList();
        });
    }

    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (State.sortConfig.column === col) {
                State.sortConfig.asc = !State.sortConfig.asc;
            } else {
                State.sortConfig.column = col;
                State.sortConfig.asc = false;
            }
            // Update UI
            document.querySelectorAll('.sortable').forEach(el => {
                el.classList.remove('active');
                if(el.querySelector('.sort-icon')) el.querySelector('.sort-icon').setAttribute('data-lucide', 'arrow-down-up');
            });
            th.classList.add('active');
            th.querySelector('.sort-icon').setAttribute('data-lucide', State.sortConfig.asc ? 'arrow-up' : 'arrow-down');
            if(typeof lucide !== 'undefined') lucide.createIcons();

            renderBlogList();
        });
    });
}

function removeBlog(url) {
    State.merged = State.merged.filter(b => b.url !== url);
    analyzeData();
    renderBlogList();
    updateStatus(`${State.merged.length} blogs active`, 'ready');
}

function renderBlogList() {
    let data = [...State.merged];
    
    // Filter
    if (State.searchQuery) {
        data = data.filter(b => 
            (b.title && b.title.toLowerCase().includes(State.searchQuery)) || 
            (b.url && b.url.toLowerCase().includes(State.searchQuery))
        );
    }

    // Sort
    data.sort((a, b) => {
        let valA = a[State.sortConfig.column];
        let valB = b[State.sortConfig.column];
        
        if (State.sortConfig.column === 'publishDate') {
            valA = valA ? valA.getTime() : 0;
            valB = valB ? valB.getTime() : 0;
        } else if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = (valB || '').toLowerCase();
            return State.sortConfig.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        
        valA = valA || 0;
        valB = valB || 0;
        return State.sortConfig.asc ? valA - valB : valB - valA;
    });

    const tbody = document.getElementById('blog-list-body');
    if (!tbody) return;

    tbody.innerHTML = data.map(b => {
        const shortUrl = b.url.length > 50 ? '…' + b.url.slice(-45) : b.url;
        const pubDate = b.publishDate ? b.publishDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
        return `<tr>
            <td>${b.title || '-'}</td>
            <td title="${b.url}" style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${shortUrl}</td>
            <td>${b.clicks.toLocaleString()}</td>
            <td>${b.impressions.toLocaleString()}</td>
            <td>${b.ctr.toFixed(2)}%</td>
            <td>${Number(b.position).toFixed(1)}</td>
            <td>${b.wordCount || '-'}</td>
            <td>${b.headingCount || '-'}</td>
            <td>${b.imageCount || '-'}</td>
            <td>${b.author || '-'}</td>
            <td>${b.category}</td>
            <td>${pubDate}</td>
            <td>
                <button class="btn btn-sm" style="color:var(--danger); border:1px solid var(--danger); background:transparent; padding: 0.25rem 0.5rem;" onclick="removeBlog('${b.url}')">
                    Remove
                </button>
            </td>
        </tr>`;
    }).join('');
}

function exportData() {
    if(!State.merged.length) return alert('No data to export');
    const cols = ['title', 'url', 'clicks', 'impressions', 'ctr', 'position', 'wordCount', 'headingCount', 'imageCount', 'internalLinks', 'category', 'publishDate', 'ageInDays', 'engagementRate', 'avgTime', 'conversions', 'revenue'];
    const csvRows = [];
    csvRows.push(cols.join(','));
    State.merged.forEach(b => {
        const vals = cols.map(c => {
            let val = b[c] !== null && b[c] !== undefined ? b[c] : '';
            if (c === 'publishDate' && val) val = val.toISOString();
            val = val.toString().replace(/"/g, '""');
            return `"${val}"`;
        });
        csvRows.push(vals.join(','));
    });
    
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blog_trend_export_${new Date().getTime()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// ============================================================
// DATA ANALYSIS & CHARTS
// ============================================================
function analyzeData() {
    let tClicks = 0, tImp = 0, tCtrSum = 0, tPosSum = 0;
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayStats = {};
    for (let i = 0; i < 7; i++) dayStats[i] = { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, ct: 0 };
    
    const hours = Array.from({length: 24}, (_, i) => `${i}:00`);
    const hourStats = {};
    for (let i = 0; i < 24; i++) hourStats[i] = { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, ct: 0 };

    const catStats = {};

    State.merged.forEach(item => {
        tClicks += item.clicks;
        tImp += item.impressions;
        tCtrSum += item.ctr;
        tPosSum += item.position;

        if (item.publishDate) {
            const d = new Date(item.publishDate);
            if (!isNaN(d.getTime())) {
                const day = d.getDay();
                dayStats[day].clicks += item.clicks;
                dayStats[day].impressions += item.impressions;
                dayStats[day].ctrSum += item.ctr;
                dayStats[day].posSum += item.position;
                dayStats[day].ct += 1;

                const hour = d.getHours();
                hourStats[hour].clicks += item.clicks;
                hourStats[hour].impressions += item.impressions;
                hourStats[hour].ctrSum += item.ctr;
                hourStats[hour].posSum += item.position;
                hourStats[hour].ct += 1;
            }
        }
        
        // Category Splitting
        let cats = (item.category || 'Uncategorized').split(',').map(c => c.trim()).filter(Boolean);
        if (cats.length === 0) cats.push('Uncategorized');
        
        cats.forEach(cat => {
            if (!catStats[cat]) catStats[cat] = { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, ct: 0 };
            catStats[cat].clicks += item.clicks;
            catStats[cat].impressions += item.impressions;
            catStats[cat].ctrSum += item.ctr;
            catStats[cat].posSum += item.position;
            catStats[cat].ct += 1;
        });
    });

    // Globals
    document.getElementById('global-clicks').innerText = tClicks.toLocaleString();
    document.getElementById('global-impressions').innerText = tImp.toLocaleString();
    document.getElementById('global-ctr').innerText = State.merged.length ? (tCtrSum / State.merged.length).toFixed(2) + '%' : '-';
    document.getElementById('global-position').innerText = State.merged.length ? (tPosSum / State.merged.length).toFixed(1) : '-';
    document.getElementById('total-blogs-count').innerText = State.merged.length;

    // Bests
    let bestDay = null, maxAvgD = -1;
    for (let i = 0; i < 7; i++) {
        if (dayStats[i].ct > 0) {
            const avg = dayStats[i].clicks / dayStats[i].ct;
            if (avg > maxAvgD) { maxAvgD = avg; bestDay = i; }
        }
    }
    if (bestDay !== null) document.getElementById('best-day').innerText = days[bestDay];

    let bestHr = null, maxAvgHr = -1;
    for (let i = 0; i < 24; i++) {
        if (hourStats[i].ct > 0) {
            const avg = hourStats[i].clicks / hourStats[i].ct;
            if (avg > maxAvgHr) { maxAvgHr = avg; bestHr = i; }
        }
    }
    if (bestHr !== null) document.getElementById('best-time').innerText = `${bestHr}:00`;

    const isLight = document.documentElement.classList.contains('light-mode');
    State.analysisObj = {
        days, dayStats, hours, hourStats, catStats,
        labelColor: isLight ? '#64748b' : '#9ca3af',
        gridColor: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
    };

    buildAllCharts();
    buildActionAlerts();
}

function buildAllCharts() {
    buildDateCharts();
    buildCategoryCharts();
    buildContentCharts();
    buildCtrCharts();
    buildPositionCharts();
}

function buildActionAlerts() {
    if (!State.merged || State.merged.length === 0) return;

    let tClicks = 0, tImp = 0, tCtrSum = 0, tWords = 0, cCount = 0;
    
    // Sort array by clicks descending to find top 10% parameters
    const sortedByClicks = [...State.merged].sort((a,b) => b.clicks - a.clicks);
    const top10PercentCount = Math.max(1, Math.floor(sortedByClicks.length * 0.1));
    const top10PercentBlogs = sortedByClicks.slice(0, top10PercentCount);
    // Calc elite word count average (exclude 0)
    const validElite = top10PercentBlogs.filter(b => b.wordCount > 0);
    const eliteWcAvg = validElite.length ? (validElite.reduce((acc, b) => acc + b.wordCount, 0) / validElite.length) : 0;

    State.merged.forEach(b => {
        tClicks += b.clicks;
        tImp += b.impressions;
        tCtrSum += b.ctr;
        if(b.wordCount > 0) { tWords += b.wordCount; cCount++; }
    });

    const globalAvgClicks = tClicks / State.merged.length;
    const globalAvgImp = tImp / State.merged.length;
    const globalAvgCtr = tCtrSum / State.merged.length;
    
    // 1. Striking Distance Matrix (Positions 11-20, impressions > avg)
    const striking = State.merged.filter(b => b.position >= 11 && b.position <= 20 && b.impressions > globalAvgImp);
    const tbody1 = document.querySelector('#alert-striking-dist tbody');
    if(tbody1) {
        tbody1.innerHTML = striking.sort((a,b) => b.impressions - a.impressions).map(b => `<tr>
            <td title="${b.url}">${b.title || ('...'+b.url.slice(-30))}</td>
            <td>${b.position.toFixed(1)}</td>
            <td>${b.impressions.toLocaleString()}</td>
            <td>${b.clicks.toLocaleString()}</td>
            <td>${b.wordCount || '-'}</td>
            <td>${b.ageInDays || '-'}</td>
        </tr>`).join('');
    }

    // 2. Content Decay (Age > 365 days and clicks < global avg)
    const decay = State.merged.filter(b => b.ageInDays > 365 && b.clicks < globalAvgClicks);
    const tbody2 = document.querySelector('#alert-content-decay tbody');
    if(tbody2) {
        tbody2.innerHTML = decay.sort((a,b) => b.ageInDays - a.ageInDays).map(b => `<tr>
            <td title="${b.url}">${b.title || ('...'+b.url.slice(-30))}</td>
            <td>${b.ageInDays}</td>
            <td>${b.clicks.toLocaleString()}</td>
            <td>${b.impressions.toLocaleString()}</td>
            <td>${b.avgTime ? b.avgTime.toFixed(1) : '-'}</td>
            <td>${b.internalLinks || 0}</td>
        </tr>`).join('');
    }

    // 3. CTR Underperformer (Impressions > avg, CTR < avg)
    const ctrUnd = State.merged.filter(b => b.impressions > globalAvgImp && b.ctr < globalAvgCtr);
    const tbody3 = document.querySelector('#alert-ctr-underperf tbody');
    if(tbody3) {
        tbody3.innerHTML = ctrUnd.sort((a,b) => a.ctr - b.ctr).map(b => `<tr>
            <td title="${b.url}">${b.title || ('...'+b.url.slice(-30))}</td>
            <td>${b.impressions.toLocaleString()}</td>
            <td style="color:var(--danger)">${b.ctr.toFixed(2)}%</td>
            <td style="color:var(--text-muted)">${globalAvgCtr.toFixed(2)}%</td>
            <td>${b.position.toFixed(1)}</td>
        </tr>`).join('');
    }

    // 4. Thin Content (WordCount < 50% of Elite average, Clicks < avg)
    const thin = State.merged.filter(b => b.wordCount > 0 && b.wordCount < (eliteWcAvg * 0.5) && b.clicks < globalAvgClicks);
    const tbody4 = document.querySelector('#alert-thin-content tbody');
    if(tbody4) {
        tbody4.innerHTML = thin.sort((a,b) => a.wordCount - b.wordCount).map(b => `<tr>
            <td title="${b.url}">${b.title || ('...'+b.url.slice(-30))}</td>
            <td style="color:var(--danger)">${b.wordCount}</td>
            <td style="color:var(--text-muted)">~${Math.round(eliteWcAvg)}</td>
            <td>${b.clicks.toLocaleString()}</td>
            <td>${b.engagementRate ? b.engagementRate.toFixed(1)+'%' : '-'}</td>
        </tr>`).join('');
    }
}

// Chart.js helper for multi-axis support
function getChartConfig(type, labels, dataMaps, xOptions = {}) {
    const { gridColor } = State.analysisObj;
    const datasets = [];
    const scales = { x: { grid: { display:false }, ...xOptions } };
    
    let yAxesCount = 0;

    State.activeMetrics.forEach((metric) => {
        if (!dataMaps[metric]) return;
        const axisId = yAxesCount === 0 ? 'y' : `y${yAxesCount}`;
        const mainColor = metricPalette[metric];
        
        // Main dataset
        datasets.push({
            label: metricLabels[metric],
            data: dataMaps[metric],
            backgroundColor: mainColor,
            borderColor: mainColor,
            borderWidth: type === 'bar' ? 0 : 2,
            borderRadius: type === 'bar' ? 4 : 0,
            pointRadius: type === 'scatter' ? 5 : 3,
            yAxisID: axisId,
            order: 2
        });

        // Trend line
        const trendData = calculateRegression(dataMaps[metric], type === 'bar' ? labels : null);
        if (trendData) {
            datasets.push({
                label: `${metricLabels[metric]} Trend`,
                data: trendData,
                borderColor: mainColor,
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                fill: false,
                type: 'line',
                yAxisID: axisId,
                order: 1,
                tension: 0
            });
        }

        scales[axisId] = {
            type: 'linear',
            display: true,
            position: yAxesCount === 0 ? 'left' : 'right',
            grid: { color: yAxesCount === 0 ? gridColor : 'transparent' },
            beginAtZero: true
        };
        // Invert Position axis if it's position since 1 is better than 100
        if (metric === 'position') scales[axisId].reverse = true;
        
        yAxesCount++;
    });

    return { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, scales, plugins: { legend: { labels: { filter: (item) => !item.text.includes('Trend') } } } } };
}

function calculateRegression(data, labels) {
    if (!data || data.length < 2) return null;
    
    let points = [];
    if (labels) {
        // Bar chart or similar with categories
        points = data.map((y, i) => ({ x: i, y: y }));
    } else {
        // Scatter plot with {x, y}
        points = data.map(p => {
            let x = p.x instanceof Date ? p.x.getTime() : p.x;
            return { x, y: p.y };
        });
    }

    // Filter out null/invalid points
    points = points.filter(p => typeof p.x === 'number' && typeof p.y === 'number' && !isNaN(p.x) && !isNaN(p.y));
    if (points.length < 2) return null;

    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    let minX = Infinity, maxX = -Infinity;

    points.forEach(p => {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumX2 += p.x * p.x;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    if (labels) {
        // Return points for every label to draw across bar chart
        return labels.map((_, i) => slope * i + intercept);
    } else {
        // Return two points for the scatter line
        const result = [
            { x: minX, y: slope * minX + intercept },
            { x: maxX, y: slope * maxX + intercept }
        ];
        // If it was dates, convert back to dates for the first/last point
        const originalData = data.find(p => (p.x instanceof Date ? p.x.getTime() : p.x) === minX);
        if (originalData && originalData.x instanceof Date) {
            result[0].x = new Date(minX);
            result[1].x = new Date(maxX);
        }
        return result;
    }
}

function createChart(id, cfg) {
    if (State.charts[id]) State.charts[id].destroy();
    const canvas = document.getElementById(id);
    if (!canvas || !cfg.data.datasets.length) return;
    Chart.defaults.color = State.analysisObj.labelColor;
    State.charts[id] = new Chart(canvas.getContext('2d'), cfg);
}

function buildDateCharts() {
    const { days, dayStats, hours, hourStats } = State.analysisObj;
    
    // Day of week
    const dmDays = {
        clicks: days.map((_, i) => dayStats[i].ct ? dayStats[i].clicks / dayStats[i].ct : 0),
        impressions: days.map((_, i) => dayStats[i].ct ? dayStats[i].impressions / dayStats[i].ct : 0),
        ctr: days.map((_, i) => dayStats[i].ct ? dayStats[i].ctrSum / dayStats[i].ct : 0),
        position: days.map((_, i) => dayStats[i].ct ? dayStats[i].posSum / dayStats[i].ct : 0)
    };
    createChart('chart-day-of-week', getChartConfig('bar', days, dmDays));

    // Time of day
    const dmHours = {
        clicks: hours.map((_, i) => hourStats[i].ct ? hourStats[i].clicks / hourStats[i].ct : 0),
        impressions: hours.map((_, i) => hourStats[i].ct ? hourStats[i].impressions / hourStats[i].ct : 0),
        ctr: hours.map((_, i) => hourStats[i].ct ? hourStats[i].ctrSum / hourStats[i].ct : 0),
        position: hours.map((_, i) => hourStats[i].ct ? hourStats[i].posSum / hourStats[i].ct : 0)
    };
    createChart('chart-time-of-day', getChartConfig('bar', hours, dmHours));

    // Scatter
    const validTime = State.merged.filter(d => d.publishDate);
    const dmScatter = {};
    State.activeMetrics.forEach(m => {
        dmScatter[m] = validTime.map(d => ({ x: new Date(d.publishDate), y: d[m] }));
    });
    createChart('chart-publish-date', getChartConfig('scatter', [], dmScatter, { type: 'time', time: { unit: 'month' }, grid: { color: State.analysisObj.gridColor } }));
}

function buildCategoryCharts() {
    const { catStats } = State.analysisObj;
    const sortedCats = Object.keys(catStats).sort((a,b) => catStats[b].clicks - catStats[a].clicks);
    
    const dmCats = {
        clicks: sortedCats.map(c => catStats[c].clicks / catStats[c].ct),
        impressions: sortedCats.map(c => catStats[c].impressions / catStats[c].ct),
        ctr: sortedCats.map(c => catStats[c].ctrSum / catStats[c].ct),
        position: sortedCats.map(c => catStats[c].posSum / catStats[c].ct)
    };
    createChart('chart-categories', getChartConfig('bar', sortedCats, dmCats));

    const tbody = document.querySelector('#category-table tbody');
    if (tbody) {
        tbody.innerHTML = sortedCats.map(c => `<tr>
            <td>${c}</td>
            <td>${catStats[c].ct}</td>
            <td>${(catStats[c].clicks / catStats[c].ct).toFixed(1)}</td>
            <td>${(catStats[c].impressions / catStats[c].ct).toFixed(0)}</td>
            <td>${(catStats[c].ctrSum / catStats[c].ct).toFixed(2)}%</td>
            <td>${(catStats[c].posSum / catStats[c].ct).toFixed(1)}</td>
        </tr>`).join('');
    }
}

function buildContentCharts() {
    const validWc = State.merged.filter(d => d.wordCount > 0);
    const dmWc = {};
    const dmImg = {};
    State.activeMetrics.forEach(m => {
        dmWc[m] = validWc.map(d => ({ x: d.wordCount, y: d[m] }));
        dmImg[m] = validWc.map(d => ({ x: d.imageCount, y: d[m] }));
    });
    createChart('chart-wordcount', getChartConfig('scatter', [], dmWc, { title:{display:true, text:"Word Count"}, grid: {color: State.analysisObj.gridColor} }));
    createChart('chart-images', getChartConfig('scatter', [], dmImg, { title:{display:true, text:"Images"}, grid: {color: State.analysisObj.gridColor} }));

    const hg = { '0-5': { ...catStatsTemplate() }, '6-10': { ...catStatsTemplate() }, '11-15': { ...catStatsTemplate() }, '16+': { ...catStatsTemplate() } };
    validWc.forEach(d => {
        const k = d.headingCount <= 5 ? '0-5' : d.headingCount <= 10 ? '6-10' : d.headingCount <= 15 ? '11-15' : '16+';
        hg[k].clicks += d.clicks; hg[k].impressions += d.impressions; hg[k].ctrSum += d.ctr; hg[k].posSum += d.position; hg[k].ct += 1;
    });
    const lblsHg = Object.keys(hg);
    const dmHg = {
        clicks: lblsHg.map(k => hg[k].ct ? hg[k].clicks / hg[k].ct : 0),
        impressions: lblsHg.map(k => hg[k].ct ? hg[k].impressions / hg[k].ct : 0),
        ctr: lblsHg.map(k => hg[k].ct ? hg[k].ctrSum / hg[k].ct : 0),
        position: lblsHg.map(k => hg[k].ct ? hg[k].posSum / hg[k].ct : 0)
    };
    createChart('chart-headings', getChartConfig('bar', lblsHg, dmHg));
}

function buildCtrCharts() {
    // Histogram of CTR
    const bins = [0, 1, 2, 3, 5, 10, 20];
    const dist = bins.map(() => 0);
    State.merged.forEach(b => {
        for(let i=1; i<bins.length; i++) {
            if(b.ctr <= bins[i]) { dist[i-1]++; break; }
        }
        if(b.ctr > bins[bins.length-1]) dist[bins.length-1]++; 
    });
    const blabels = bins.map((b,i) => i===bins.length-1 ? `${b}%+` : `${b}-${bins[i+1]}%`);
    createChart('chart-ctr-distribution', {
        type: 'bar', data: { labels: blabels, datasets: [{ label: 'Number of Blogs', data: dist, backgroundColor: metricPalette.ctr }] },
        options: { responsive: true, maintainAspectRatio: false, scales:{x:{grid:{display:false}},y:{beginAtZero:true}} }
    });

    // Scatter WC vs CTR
    const validWc = State.merged.filter(d => d.wordCount > 0);
    createChart('chart-ctr-wordcount', getChartConfig('scatter', [], {ctr: validWc.map(d=>({x:d.wordCount,y:d.ctr})) }, {title:{display:true, text:"Word Count"}}));
    
    // Scatter Pos vs CTR
    createChart('chart-ctr-position', getChartConfig('scatter', [], {ctr: State.merged.map(d=>({x:d.position,y:d.ctr})) }, {title:{display:true, text:"Average Position"}}));
}

function buildPositionCharts() {
    const bins = [1, 3, 5, 10, 20, 50, 100];
    const dist = bins.map(() => 0);
    State.merged.forEach(b => {
        for(let i=1; i<bins.length; i++) {
            if(b.position <= bins[i]) { dist[i-1]++; break; }
        }
        if(b.position > bins[bins.length-1]) dist[bins.length-1]++; 
    });
    const blabels = bins.map((b,i) => i===bins.length-1 ? `${b}+` : `${b}-${bins[i+1]}`);
    createChart('chart-position-distribution', {
        type: 'bar', data: { labels: blabels, datasets: [{ label: 'Number of Blogs', data: dist, backgroundColor: metricPalette.position }] },
        options: { responsive: true, maintainAspectRatio: false, scales:{x:{grid:{display:false}},y:{beginAtZero:true}} }
    });

    const validWc = State.merged.filter(d => d.wordCount > 0);
    createChart('chart-position-wordcount', getChartConfig('scatter', [], {position: validWc.map(d=>({x:d.wordCount,y:d.position})) }, {title:{display:true, text:"Word Count"}}));
    
    const sortedCats = Object.keys(State.analysisObj.catStats).sort((a,b) => State.analysisObj.catStats[b].clicks - State.analysisObj.catStats[a].clicks).slice(0, 10);
    const dmPos = { position: sortedCats.map(c => State.analysisObj.catStats[c].posSum / State.analysisObj.catStats[c].ct) };
    createChart('chart-position-category', getChartConfig('bar', sortedCats, dmPos));
}

function catStatsTemplate() { return { clicks: 0, impressions: 0, ctrSum: 0, posSum: 0, ct: 0 }; }

function renderChartsForTab(tab) {
    setTimeout(() => {
        Object.values(State.charts).forEach(c => {
            if (c.canvas && c.canvas.closest(`#tab-${tab}`)) c.resize();
        });
    }, 50);
}

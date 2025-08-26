// Immediately invoked function to set the theme on initial load
(function() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
})();

// --- Dark Mode Logic ---
const darkModeToggle = document.getElementById('darkModeToggle');
const darkModeToggleMobile = document.getElementById('darkModeToggleMobile');

function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    localStorage.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

darkModeToggle.addEventListener('click', toggleDarkMode);
darkModeToggleMobile.addEventListener('click', toggleDarkMode);


// --- State Management ---
let currentUserPlan = 'free';
let activePage = 'dashboardPage';
let billingCycle = 'monthly';
let currentWizardStep = 1;
let leadTrendsChartInstance = null;
let sourceBreakdownChartInstance = null;
let monitorsUnsubscribe = null; // To detach Firestore listener on logout
let leadsUnsubscribe = null; // To detach Firestore listener for leads
let allLeads = []; // Cache for all leads from Firestore
let scanResultsLeads = []; // Cache for on-demand scan leads
let leadsToShow = 5; // State for "Show More" functionality
let currentFilter = 'all'; // State for lead filtering

// --- DOM Elements ---
const pageElements = {
    landingPage: document.getElementById('landingPage'),
    appWrapper: document.getElementById('appWrapper'),
    dashboardPage: document.getElementById('dashboardPage'),
    analyticsPage: document.getElementById('analyticsPage'),
    settingsPage: document.getElementById('settingsPage'),
};
const navLinks = {
    dashboard: document.getElementById('nav-dashboard'),
    analytics: document.getElementById('nav-analytics'),
    settings: document.getElementById('nav-settings'),
};
const dashboardVariants = {
    free: document.getElementById('dashboardFree'),
    pro: document.getElementById('dashboardPro'),
    elite: document.getElementById('dashboardElite'),
};
const analyticsVariants = {
    pro: document.getElementById('analyticsPro'),
    elite: document.getElementById('analyticsElite'),
};
const mobileMenuButton = document.getElementById('mobile-menu-button');
const mobileMenu = document.getElementById('mobile-menu');
const appSidebar = document.getElementById('app-sidebar');
const openSidebarButton = document.getElementById('open-sidebar-button');
const closeSidebarButton = document.getElementById('close-sidebar-button');

// --- Onboarding Wizard DOM Elements ---
const onboardingWizard = document.getElementById('onboardingWizard');
const wizardStepIndicator = document.getElementById('wizardStepIndicator');
const wizardSteps = {
    1: document.getElementById('wizardStep1'),
    2: document.getElementById('wizardStep2'),
    3: document.getElementById('wizardStep3'),
};
const wizardButtons = {
    next1: document.getElementById('wizard-next-1'),
    next2: document.getElementById('wizard-next-2'),
    back2: document.getElementById('wizard-back-2'),
    back3: document.getElementById('wizard-back-3'),
    finish: document.getElementById('wizard-finish'),
};

// --- Scan Modal DOM Elements ---
const scanModal = document.getElementById('scanModal');
const openScanModalBtns = document.querySelectorAll('.openScanModalBtn');
const closeScanModalBtn = document.getElementById('closeScanModalBtn');
const cancelScanBtn = document.getElementById('cancelScanBtn');

// --- Scan Modal Logic ---
function openScanModal() { scanModal.classList.remove('hidden'); }
function closeScanModal() { scanModal.classList.add('hidden'); }
openScanModalBtns.forEach(btn => btn.addEventListener('click', openScanModal));
closeScanModalBtn.addEventListener('click', closeScanModal);
cancelScanBtn.addEventListener('click', closeScanModal);
scanModal.addEventListener('click', (event) => {
    if (event.target === scanModal) closeScanModal();
});

// --- NEW: Notification System ---
function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notif = document.createElement('div');
    notif.className = `notification notification-${type}`;

    let iconClass = 'fa-solid fa-circle-info';
    if (type === 'success') iconClass = 'fa-solid fa-check-circle';
    if (type === 'error') iconClass = 'fa-solid fa-triangle-exclamation';

    notif.innerHTML = `
        <i class="${iconClass} notification-icon"></i>
        <p class="text-sm font-medium">${message}</p>
    `;

    container.appendChild(notif);

    setTimeout(() => { notif.classList.add('show'); }, 10);

    setTimeout(() => {
        notif.classList.remove('show');
        notif.addEventListener('transitionend', () => notif.remove());
    }, 5000);
}

// --- NEW: Confirmation Modal Logic ---
const confirmationModal = document.getElementById('confirmationModal');
const confirmMessage = document.getElementById('confirmationMessage');
const confirmActionBtn = document.getElementById('confirmActionBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
let confirmCallback = null;

function showConfirmation(message, onConfirm) {
    confirmMessage.textContent = message;
    confirmCallback = onConfirm;
    confirmationModal.classList.remove('hidden');
}

confirmActionBtn.addEventListener('click', () => {
    if (typeof confirmCallback === 'function') {
        confirmCallback();
    }
    confirmationModal.classList.add('hidden');
    confirmCallback = null;
});

confirmCancelBtn.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmCallback = null;
});


// --- Core Functions ---
function switchUserPlan(newPlan) {
    currentUserPlan = newPlan;
    renderUI();
}

function showPage(pageId) {
    activePage = pageId;
    const user = auth.currentUser;
    if (pageId === 'settingsPage' && user) {
        loadUserSettings();
    }
    renderUI();
}

function renderUI() {
    Object.values(pageElements).forEach(el => el.classList.add('hidden'));
    if (activePage === 'landingPage') {
        pageElements.landingPage.classList.remove('hidden');
    } else {
        pageElements.appWrapper.classList.remove('hidden');
        if(pageElements[activePage]) pageElements[activePage].classList.remove('hidden');
    }
    document.getElementById('current-plan-label').textContent = currentUserPlan;
    Object.values(navLinks).forEach(link => link.classList.remove('active', 'disabled', 'premium-highlight'));
    if(navLinks[activePage.replace('Page', '')]) navLinks[activePage.replace('Page', '')].classList.add('active');
    Object.values(dashboardVariants).forEach(el => el.style.display = 'none');
    Object.values(analyticsVariants).forEach(el => el.style.display = 'none');
    if(dashboardVariants[currentUserPlan]) dashboardVariants[currentUserPlan].style.display = 'block';

    if (currentUserPlan === 'free') {
        navLinks.analytics.classList.add('disabled');
    } else {
        navLinks.analytics.classList.remove('disabled');
        if (currentUserPlan === 'pro') {
            if(analyticsVariants.pro) analyticsVariants.pro.style.display = 'block';
            if (activePage === 'analyticsPage') updateAnalytics(allLeads);
        } else { // Elite
            navLinks.analytics.classList.add('premium-highlight');
            if(analyticsVariants.elite) analyticsVariants.elite.style.display = 'block';
            if (activePage === 'analyticsPage' && allLeads.length > 0) {
                updateAnalytics(allLeads);
            }
        }
    }
}

function renderAnalyticsCharts(trendData, sourceData) {
    const leadTrendsCtx = document.getElementById('leadTrendsChart')?.getContext('2d');
    const sourceBreakdownCtx = document.getElementById('sourceBreakdownChart')?.getContext('2d');
    if (!leadTrendsCtx || !sourceBreakdownCtx) return;

    document.getElementById('leadTrendsLoader').classList.add('hidden');
    document.getElementById('sourceBreakdownLoader').classList.add('hidden');
    document.getElementById('leadTrendsChart').classList.remove('hidden');
    document.getElementById('sourceBreakdownChart').classList.remove('hidden');
    
    const isDarkMode = document.documentElement.classList.contains('dark');
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDarkMode ? '#E5E7EB' : '#1F2937';


    if (leadTrendsChartInstance) leadTrendsChartInstance.destroy();
    leadTrendsChartInstance = new Chart(leadTrendsCtx, {
        type: 'line',
        data: {
            labels: trendData.labels,
            datasets: [{ label: 'Leads Found', data: trendData.data, fill: false, borderColor: '#3B82F6', tension: 0.1 }]
        },
        options: {
            scales: {
                y: { ticks: { color: textColor }, grid: { color: gridColor } },
                x: { ticks: { color: textColor }, grid: { color: gridColor } }
            },
            plugins: { legend: { labels: { color: textColor } } }
        }
    });

    if (sourceBreakdownChartInstance) sourceBreakdownChartInstance.destroy();
    sourceBreakdownChartInstance = new Chart(sourceBreakdownCtx, {
        type: 'doughnut',
        data: {
            labels: sourceData.labels,
            datasets: [{ label: 'Lead Sources', data: sourceData.data, backgroundColor: ['#FF4500', '#333333', '#FF0000', '#1877F2', '#6b21a8'], hoverOffset: 4 }]
        },
        options: {
            plugins: { legend: { labels: { color: textColor } } }
        }
    });
}

function updatePricing(cycle) {
    billingCycle = cycle;
    document.querySelectorAll('.pricing-button').forEach(button => button.classList.remove('active'));
    document.querySelector(`.pricing-button[onclick="updatePricing('${cycle}')"]`).classList.add('active');
    document.querySelectorAll('[data-price-monthly]').forEach(priceEl => {
        const parentCard = priceEl.closest('.card');
        const totalTextEl = parentCard.querySelector('.billing-total-text');
        const monthlyPrice = parseFloat(priceEl.dataset.priceMonthly.replace('$', ''));
        switch(cycle) {
            case 'yearly':
                priceEl.textContent = priceEl.dataset.priceYearly;
                if (totalTextEl && monthlyPrice > 0) totalTextEl.textContent = `Billed as $${(monthlyPrice * 12 * 0.75).toFixed(2)} per year`;
                else if (totalTextEl) totalTextEl.textContent = '';
                break;
            case 'twoyear':
                priceEl.textContent = priceEl.dataset.priceTwoyear;
                if (totalTextEl && monthlyPrice > 0) totalTextEl.textContent = `Billed as $${(monthlyPrice * 24 * 0.65).toFixed(2)} every 2 years`;
                else if (totalTextEl) totalTextEl.textContent = '';
                break;
            default:
                priceEl.textContent = priceEl.dataset.priceMonthly;
                if (totalTextEl) totalTextEl.textContent = '';
                break;
        }
    });
}

// --- Event Listeners ---
mobileMenuButton.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
openSidebarButton.addEventListener('click', () => appSidebar.classList.remove('-translate-x-full'));
closeSidebarButton.addEventListener('click', () => appSidebar.classList.add('-translate-x-full'));

// --- Notification Functions ---
function requestNotificationPermission() {
    if (!("Notification" in window)) {
        console.log("This browser does not support desktop notification");
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") console.log("Notification permission granted.");
        });
    }
}

function showNewLeadNotification(lead) {
    if (Notification.permission === "granted") {
        const notification = new Notification("New Lead Found!", {
            body: `Source: ${lead.source}\nKeyword: "${lead.keyword}"`,
            icon: "https://carrev.shop/wp-content/uploads/2025/08/Xlead-logo.png" 
        });
    }
}

// --- New/Updated Functions for Features ---
function refreshLeads() {
    const user = auth.currentUser;
    if (user) {
        console.log("Manual refresh triggered.");
        listenForLeads(user.uid);
    }
}

function copyToClipboard(elementId, buttonElement) {
    const textToCopy = document.getElementById(elementId).innerText;
    const tempInput = document.createElement('input');
    document.body.appendChild(tempInput);
    tempInput.value = textToCopy;
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    
    showNotification(`Copied "${textToCopy}" to clipboard!`, 'success');
}

function copyReferralLink() {
    const input = document.getElementById('referral-link-input');
    input.select();
    document.execCommand('copy');
    showNotification('Referral link copied!', 'success');
}

async function deleteMonitor(monitorId) {
    const user = auth.currentUser;
    if (!user) return;
    
    showConfirmation("Are you sure you want to delete this monitor?", async () => {
         try {
              await db.collection('users').doc(user.uid).collection('monitors').doc(monitorId).delete();
              showNotification("Monitor deleted successfully.", "success");
              console.log("Monitor deleted successfully:", monitorId);
           } catch (error) {
              console.error("Error deleting monitor:", error);
              showNotification("Failed to delete monitor.", "error");
           }
    });
}

function showMoreLeads() {
    leadsToShow += 6; // Increase the number of leads to show by 6 for a 3-column grid
    renderLeads(allLeads);
}

// --- Routing Logic ---
function navigateTo(pageId) {
    const user = auth.currentUser;
    if (pageId === 'landingPage') {
        window.location.hash = '';
    } else if (user) {
        window.location.hash = `${pageId.replace('Page', '')}/${user.uid}`;
    }
}

function handleRouting() {
    const hash = window.location.hash.replace('#', '');
    const user = auth.currentUser;
    const [page, userId] = hash.split('/');

    if (user && userId === user.uid && (page === 'dashboard' || page === 'analytics' || page === 'settings')) {
        showPage(page + 'Page');
    } else if (user && !page) {
        navigateTo('dashboardPage');
    }
    else {
        showPage('landingPage');
    }
}

// --- Initial Load ---
window.addEventListener('hashchange', handleRouting);
window.addEventListener('load', () => {
    updatePricing('monthly');
});

window.switchUserPlan = switchUserPlan;
window.updatePricing = updatePricing;
window.refreshLeads = refreshLeads;
window.copyReferralLink = copyReferralLink;
window.deleteMonitor = deleteMonitor;
window.showMoreLeads = showMoreLeads;
window.navigateTo = navigateTo;
window.copyToClipboard = copyToClipboard;

// Your web app's Firebase configuration
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyC2LTtzKjnO8wGg1MqpYJclfMqAf1E4o9c",
    authDomain: "xlead-app.firebaseapp.com",
    projectId: "xlead-app",
    storageBucket: "xlead-app.appspot.com",
    messagingSenderId: "323197042769",
    appId: "1:323197042769:web:074658fd06b57de4aab870",
    measurementId: "G-RDH9VJ4FZW"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const provider = new firebase.auth.GoogleAuthProvider();

async function signInWithGoogle() {
    try {
        const result = await auth.signInWithPopup(provider);
        const user = result.user;
        const isNewUser = result.additionalUserInfo.isNewUser;

        const userDoc = {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            lastLogin: new Date()
        };
        
        if (isNewUser) {
            userDoc.createdAt = new Date();
            userDoc.profile_complete = false;
        }

        await db.collection("users").doc(user.uid).set(userDoc, { merge: true });
        console.log("User signed in and data saved to Firestore:", user.displayName);
        window.switchUserPlan('free');
    } catch (error) {
        console.error("Error during Google Sign-In:", error);
        showNotification(`Sign-in failed: ${error.message}`, 'error');
    }
}

async function signOutUser() {
    try {
        await auth.signOut();
        console.log("User signed out.");
    } catch (error) {
        console.error("Error signing out:", error);
        showNotification(`Sign-out failed: ${error.message}`, 'error');
    }
}

function updateUIAfterSignIn(user) {
    document.getElementById('auth-links-desktop').classList.add('hidden');
    document.getElementById('user-profile-desktop').classList.remove('hidden');
    document.getElementById('user-profile-desktop').classList.add('flex');
    document.getElementById('user-photo-desktop').src = user.photoURL;
    document.getElementById('user-name-desktop').textContent = user.displayName;

    document.getElementById('auth-links-mobile').classList.add('hidden');
    document.getElementById('user-profile-mobile').classList.remove('hidden');
    document.getElementById('user-profile-mobile').classList.add('flex');
    document.getElementById('user-photo-mobile').src = user.photoURL;
    document.getElementById('user-name-mobile').textContent = user.displayName;
    
    const referralLinkInput = document.getElementById('referral-link-input');
    if (referralLinkInput) {
        referralLinkInput.value = `https://xlead.online/#ref=${user.uid}`;
    }
}

function updateUIAfterSignOut() {
    document.getElementById('auth-links-desktop').classList.remove('hidden');
    document.getElementById('user-profile-desktop').classList.add('hidden');
    document.getElementById('user-profile-desktop').classList.remove('flex');

    document.getElementById('auth-links-mobile').classList.remove('hidden');
    document.getElementById('user-profile-mobile').classList.add('hidden');
    document.getElementById('user-profile-mobile').classList.remove('flex');

    if (monitorsUnsubscribe) monitorsUnsubscribe();
    if (leadsUnsubscribe) leadsUnsubscribe();
    allLeads = [];
}

function handlePlanSelection(plan) {
    if (auth.currentUser) {
        window.switchUserPlan(plan);
        navigateTo('dashboardPage');
    } else {
        signInWithGoogle();
    }
}

async function saveSettings(event) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
        showNotification("You must be logged in to save settings.", "error");
        return;
    }

    const businessProfileData = {
        industry: document.getElementById('settings-industry').value,
        product_description: document.getElementById('settings-product-description').value,
        ideal_customer: document.getElementById('settings-ideal-customer').value,
        customer_problems: document.getElementById('settings-customer-problems').value,
        keywords: document.getElementById('settings-keywords').value,
    };

    const telegramId = document.getElementById('telegram-input').value;

    try {
        await db.collection('users').doc(user.uid).update({
            telegramChatId: telegramId,
            business_profile: businessProfileData
        });
        showNotification("Settings saved successfully!", "success");
    } catch (error) {
        console.error("Error saving settings:", error);
        showNotification("Failed to save settings.", "error");
    }
}

async function addMonitor(event, plan) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
        showNotification("You must be logged in to add a monitor.", "error");
        return;
    }
    const productName = document.getElementById(`${plan}-product-name`).value;
    const keywords = document.getElementById(`${plan}-keywords`).value;
    if (!productName || !keywords) {
        showNotification("Please fill out both fields.", "error");
        return;
    }

    const payload = {
        productName: productName,
        keywords: keywords,
        userId: user.uid
    };

    try {
        await db.collection('users').doc(user.uid).collection('monitors').add({
            productName: productName,
            keywords: keywords,
            createdAt: new Date()
        });

        const response = await fetch('https://329974c44455.ngrok-free.app/add-monitor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error("API call failed with status:", response.status, "Response:", errorData);
            throw new Error(`API call failed: ${response.statusText}`);
        }

        showNotification("Monitor added successfully!", "success");
        event.target.reset();

    } catch (error) {
        console.error("Error adding monitor:", error);
        showNotification("Failed to add monitor. Check console.", "error");
    }
}

function renderMonitors(monitors) {
    const proList = document.getElementById('pro-monitors-list');
    const eliteList = document.getElementById('elite-monitors-list');
    proList.innerHTML = '';
    eliteList.innerHTML = '';

    if (monitors.length === 0) {
        const placeholder = '<p class="text-sm text-gray-500 dark:text-gray-400">No active monitors yet.</p>';
        proList.innerHTML = placeholder;
        eliteList.innerHTML = placeholder;
        return;
    }

    monitors.forEach(monitor => {
        const monitorHtml = `
            <div class="p-4 border dark:border-gray-700 rounded-lg flex justify-between items-center">
                <div>
                    <p class="font-semibold">${monitor.productName}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">${monitor.keywords}</p>
                </div>
                <button onclick="deleteMonitor('${monitor.id}')" class="text-red-500 hover:text-red-700 transition">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        proList.innerHTML += monitorHtml;
        eliteList.innerHTML += monitorHtml;
    });
}

async function loadUserSettings() {
    const user = auth.currentUser;
    if (!user) return;
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
        const userData = userDoc.data();
        document.getElementById('full-name-input').value = userData.displayName || '';
        document.getElementById('email-input').value = userData.email || '';
        document.getElementById('telegram-input').value = userData.telegramChatId || '';

        if (userData.business_profile) {
            document.getElementById('settings-industry').value = userData.business_profile.industry || '';
            document.getElementById('settings-product-description').value = userData.business_profile.product_description || '';
            document.getElementById('settings-ideal-customer').value = userData.business_profile.ideal_customer || '';
            document.getElementById('settings-customer-problems').value = userData.business_profile.customer_problems || '';
            document.getElementById('settings-keywords').value = userData.business_profile.keywords || '';
        }
    }
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        requestNotificationPermission();
        updateUIAfterSignIn(user);

        const userDocRef = db.collection('users').doc(user.uid);
        const userDoc = await userDocRef.get();
        
        if (userDoc.exists && userDoc.data().profile_complete === false) {
            onboardingWizard.classList.remove('hidden');
        } else {
            monitorsUnsubscribe = db.collection('users').doc(user.uid).collection('monitors')
                .orderBy('createdAt', 'desc')
                .onSnapshot(snapshot => {
                    const monitors = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    renderMonitors(monitors);
                }, error => {
                    console.error("Error fetching monitors:", error);
                });
            
            if (!window.location.hash.includes(user.uid)) {
                navigateTo('dashboardPage');
            } else {
                handleRouting();
            }
            listenForLeads(user.uid);
        }

    } else {
        updateUIAfterSignOut();
        navigateTo('landingPage');
    }
});

document.getElementById('settings-form').addEventListener('submit', saveSettings);
document.getElementById('pro-monitor-form').addEventListener('submit', (e) => addMonitor(e, 'pro'));
document.getElementById('elite-monitor-form').addEventListener('submit', (e) => addMonitor(e, 'elite'));
document.getElementById('free-monitor-form').addEventListener('submit', (e) => {
    e.preventDefault();
    showNotification("Please upgrade to add monitors.", "info");
});

// --- Onboarding Wizard Logic ---
function updateWizardStep(newStep) {
    currentWizardStep = newStep;
    Object.values(wizardSteps).forEach(step => step.classList.add('hidden'));
    if (wizardSteps[currentWizardStep]) {
        wizardSteps[currentWizardStep].classList.remove('hidden');
        wizardStepIndicator.textContent = `Step ${currentWizardStep} of 3`;
    }
}

async function finishOnboarding() {
    const user = auth.currentUser;
    if (!user) return;

    const businessProfileData = {
        industry: document.getElementById('wizard-industry').value,
        product_description: document.getElementById('wizard-product-description').value,
        ideal_customer: document.getElementById('wizard-ideal-customer').value,
        customer_problems: document.getElementById('wizard-customer-problems').value,
        keywords: document.getElementById('wizard-keywords').value,
    };
    const telegramId = document.getElementById('wizard-telegram-id').value;

    try {
        await db.collection('users').doc(user.uid).update({
            business_profile: businessProfileData,
            telegramChatId: telegramId,
            profile_complete: true
        });

        onboardingWizard.classList.add('hidden');
        navigateTo('dashboardPage');
        window.location.reload();

    } catch (error) {
        console.error("Error finishing onboarding:", error);
        showNotification("Error saving your profile. Please try again.", "error");
    }
}

wizardButtons.next1.addEventListener('click', () => updateWizardStep(2));
wizardButtons.next2.addEventListener('click', () => updateWizardStep(3));
wizardButtons.back2.addEventListener('click', () => updateWizardStep(1));
wizardButtons.back3.addEventListener('click', () => updateWizardStep(2));
wizardButtons.finish.addEventListener('click', finishOnboarding);


// =======================================================
// --- REAL-TIME LEADS & ANALYTICS FUNCTIONALITY ---
// =======================================================

async function startOnDemandScan(event) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
        showNotification("You must be logged in to start a scan.", "error");
        return;
    }

    const subreddit = document.getElementById('scan-subreddit-input').value;
    const postLimit = document.getElementById('scan-post-count').value;
    const submitBtn = document.querySelector('#scan-form button[type="submit"]');

    if (!subreddit) {
        showNotification("Please enter a subreddit to scan.", "error");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="spinner" style="width: 20px; height: 20px; border-width: 2px; margin-right: 8px;"></div> Scanning...`;

    try {
        const payload = {
            subreddit: subreddit,
            postLimit: parseInt(postLimit, 10),
            userId: user.uid
        };

        const response = await fetch('http://127.0.0.1:4000/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Scan failed with status: ${response.status}`);
        }

        const data = await response.json(); 
        
        if (data && data.leads) {
            renderScanResults(data.leads);
            document.getElementById('scanResultsWrapper').classList.remove('hidden');
            closeScanModal();
        } else {
            throw new Error("Invalid response format from server.");
        }

    } catch (error) {
        console.error("On-demand scan failed:", error);
        showNotification("The scan failed. Please try again later.", "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Start Scan';
    }
}

function renderScanResults(leads) {
    const container = document.getElementById('scanResultsContainer');
    container.innerHTML = '';
    scanResultsLeads = leads;

    if (!leads || leads.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 text-center p-4">No new leads found in this scan.</p>';
        return;
    }

    const platformIcons = {
        'Reddit': { icon: 'fa-reddit-alien', color: 'text-red-500' },
        'X': { icon: 'fa-x-twitter', color: 'text-black dark:text-white' },
        'YouTube': { icon: 'fa-youtube', color: 'text-red-600' },
        'Facebook': { icon: 'fa-facebook', color: 'text-blue-600' },
        'Forum': { icon: 'fa-comments', color: 'text-purple-600' }
    };

    let allLeadsHtml = '';

    leads.forEach(lead => {
        if (!lead.id) {
            lead.id = `scan-${Math.random().toString(36).substr(2, 9)}`;
        }
        const iconInfo = platformIcons[lead.source] || { icon: 'fa-question-circle', color: 'text-gray-500' };
        
        let highlightedText = lead.text; 
        if (lead.keyword) {
            const escapedKeyword = lead.keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            highlightedText = lead.text.replace(new RegExp(escapedKeyword, 'gi'), (match) => `<strong class="text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 rounded-sm px-1">${match}</strong>`);
        }
        
        const analysisHtml = lead.analysis ? `
            <div class="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-4">
                <div>
                    <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Summary</h4>
                    <p class="text-sm text-gray-800 dark:text-gray-200 mt-1">${lead.analysis.summary || 'Not available.'}</p>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                        <span class="text-lg">🔥</span>
                        <div>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Buying Intent</p>
                            <p class="font-bold text-sm text-gray-800 dark:text-gray-200">${lead.analysis.intent_score || 'N/A'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-md">
                        <span class="text-lg">👤</span>
                        <div>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Customer Persona</p>
                            <p class="font-bold text-sm text-gray-800 dark:text-gray-200">${lead.analysis.customer_persona || 'N/A'}</p>
                        </div>
                    </div>
                </div>
                ${(lead.analysis.pain_points && Array.isArray(lead.analysis.pain_points) && lead.analysis.pain_points.length > 0) ? `
                <div>
                    <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pain Points</h4>
                    <ul class="list-disc list-inside mt-1 space-y-1">
                        ${lead.analysis.pain_points.map(point => `<li class="text-sm text-gray-700 dark:text-gray-300">${point}</li>`).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>
        ` : '';

        const leadHtml = `
            <div class="p-4 border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <div class="flex items-start justify-between">
                    <div class="flex items-center gap-3">
                        <i class="fab ${iconInfo.icon} text-2xl ${iconInfo.color} w-6 text-center"></i>
                        <div>
                            <p class="font-semibold text-gray-800 dark:text-gray-100">${lead.source}</p>
                            <p class="text-xs text-gray-500 dark:text-gray-400">Keyword: "${lead.keyword}"</p>
                        </div>
                    </div>
                </div>
                <p class="text-gray-700 dark:text-gray-300 mt-3">${highlightedText}</p>
                ${analysisHtml}
                 <div class="border-t border-gray-200 dark:border-gray-700 mt-3 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <button onclick="getAiReply('${lead.id}', this)" class="text-sm px-4 py-2 rounded-lg font-semibold bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition w-full sm:w-auto">🤖 Suggest AI Reply</button>
                    <a href="${lead.url}" target="_blank" class="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">View Conversation &rarr;</a>
                </div>
                <div id="reply-container-${lead.id}" class="hidden mt-4 space-y-2">
                    <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Suggested Reply</h4>
                    <textarea id="reply-textarea-${lead.id}" class="w-full h-32 p-2 border rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 text-sm" readonly></textarea>
                    <button onclick="copyReply('${lead.id}')" class="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">Copy Reply</button>
                </div>
            </div>
        `;
        allLeadsHtml += leadHtml;
    });

    container.innerHTML = allLeadsHtml;
}

document.getElementById('scan-form').addEventListener('submit', startOnDemandScan);
document.getElementById('clearScanResultsBtn').addEventListener('click', () => {
    document.getElementById('scanResultsContainer').innerHTML = '';
    document.getElementById('scanResultsWrapper').classList.add('hidden');
    scanResultsLeads = [];
});


function filterLeads(status) {
    currentFilter = status;
    leadsToShow = 5;
    renderLeads(allLeads);
}
window.filterLeads = filterLeads;

async function updateLeadStatus(leadId, newStatus) {
    console.log(`Updating lead ${leadId} to status: ${newStatus}`);
    try {
        await db.collection('leads').doc(leadId).update({
            status: newStatus
        });
        const leadIndex = allLeads.findIndex(lead => lead.id === leadId);
        if (leadIndex !== -1) {
            allLeads[leadIndex].status = newStatus;
        }
        renderLeads(allLeads);
    } catch (error) {
        console.error("Error updating lead status:", error);
        showNotification("Could not update lead status.", "error");
    }
}
window.updateLeadStatus = updateLeadStatus;


async function listenForLeads(userId) {
    const proFeed = document.getElementById('pro-leads-feed');
    const eliteFeed = document.getElementById('elite-leads-feed');
    const loadingHtml = '<div class="flex justify-center items-center h-64"><div class="spinner"></div></div>';
    if (proFeed) proFeed.innerHTML = loadingHtml;
    if (eliteFeed) eliteFeed.innerHTML = loadingHtml;

    await seedInitialData(userId);
    if (leadsUnsubscribe) leadsUnsubscribe();

    const leadsQuery = db.collection('leads')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc'); 

    try {
        const snapshot = await leadsQuery.get();
        allLeads = snapshot.docs.map(doc => ({
            id: doc.id, ...doc.data(), timestamp: doc.data().timestamp.toDate()
        }));
        leadsToShow = 6; 
        renderLeads(allLeads);
        updateAnalytics(allLeads);

        leadsUnsubscribe = db.collection('leads')
            .where('userId', '==', userId)
            .where('timestamp', '>', new Date())
            .onSnapshot(snapshot => {
                let newLeadsFound = false;
                snapshot.docChanges().forEach(change => {
                    if (change.type === "added") {
                        newLeadsFound = true;
                        const newLead = {
                            id: change.doc.id, ...change.doc.data(), timestamp: change.doc.data().timestamp.toDate()
                        };
                        allLeads.unshift(newLead);
                        showNewLeadNotification(newLead);
                    }
                });
                if (newLeadsFound) {
                    renderLeads(allLeads);
                    updateAnalytics(allLeads);
                }
            }, error => console.error("Error with real-time leads listener:", error));

    } catch (error) {
        console.error("Error fetching initial leads:", error);
    }
}

function renderLeads(leads) {
    const proFeed = document.getElementById('pro-leads-feed');
    const eliteFeed = document.getElementById('elite-leads-feed');
    const proFeedFooter = document.getElementById('pro-leads-footer');
    const eliteFeedFooter = document.getElementById('elite-leads-footer');
    const proFilterControls = document.getElementById('pro-filter-controls');
    const eliteFilterControls = document.getElementById('elite-filter-controls');
    
    proFeed.innerHTML = '';
    eliteFeed.innerHTML = '';
    if(proFeedFooter) proFeedFooter.innerHTML = '';
    if(eliteFeedFooter) eliteFeedFooter.innerHTML = '';

    const filterButtonsHtml = `
        <button onclick="filterLeads('all')" class="filter-btn ${currentFilter === 'all' ? 'active' : ''}">All Leads</button>
        <button onclick="filterLeads('starred')" class="filter-btn ${currentFilter === 'starred' ? 'active' : ''}">Starred</button>
        <button onclick="filterLeads('archived')" class="filter-btn ${currentFilter === 'archived' ? 'active' : ''}">Archived</button>
    `;
    proFilterControls.innerHTML = filterButtonsHtml;
    eliteFilterControls.innerHTML = filterButtonsHtml;

    let filteredLeads = leads;
    if (currentFilter === 'all') {
        filteredLeads = leads.filter(lead => lead.status !== 'archived');
    } else if (currentFilter === 'starred') {
        filteredLeads = leads.filter(lead => lead.status === 'starred');
    } else if (currentFilter === 'archived') {
        filteredLeads = leads.filter(lead => lead.status === 'archived');
    }

    if (filteredLeads.length === 0) {
        const placeholder = `<p class="text-sm text-gray-500 dark:text-gray-400 text-center p-4 col-span-full">No leads match the current filter.</p>`;
        proFeed.innerHTML = placeholder;
        eliteFeed.innerHTML = placeholder;
        return;
    }

    const platformIcons = {
        'Reddit': { icon: 'fa-reddit-alien', color: 'text-red-500' },
        'X': { icon: 'fa-x-twitter', color: 'text-black dark:text-white' },
        'YouTube': { icon: 'fa-youtube', color: 'text-red-600' },
        'Facebook': { icon: 'fa-facebook', color: 'text-blue-600' },
        'Forum': { icon: 'fa-comments', color: 'text-purple-600' }
    };

    const leadsToDisplay = filteredLeads.slice(0, leadsToShow);
    let allLeadsHtml = '';

    leadsToDisplay.forEach(lead => {
        const iconInfo = platformIcons[lead.source] || { icon: 'fa-question-circle', color: 'text-gray-500' };
        
        let highlightedText = lead.text;
        if (lead.keyword) {
            const escapedKeyword = lead.keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            highlightedText = lead.text.replace(new RegExp(escapedKeyword, 'gi'), (match) => `<strong class="text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 rounded-sm px-1">${match}</strong>`);
        }
        
        let cardClasses = 'card p-5 transition-all duration-300';
        if (lead.status === 'archived') cardClasses += ' opacity-50';
        if (lead.status === 'starred') cardClasses += ' ring-2 ring-yellow-400 dark:ring-yellow-500';
        const starIconClass = lead.status === 'starred' ? 'text-yellow-400' : 'text-gray-400';

        const leadHtml = `
        <div class="${cardClasses} flex flex-col h-full">
            <!-- Card Header -->
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-3 overflow-hidden">
                    <i class="fab ${iconInfo.icon} text-2xl ${iconInfo.color} w-6 text-center flex-shrink-0"></i>
                    <div class="truncate">
                        <p class="font-semibold text-gray-800 dark:text-gray-100 truncate">${lead.source}</p>
                        <p class="text-xs text-gray-500 dark:text-gray-400 truncate">Keyword: "${lead.keyword}"</p>
                    </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0 -mr-2 -mt-2">
                    <button onclick="updateLeadStatus('${lead.id}', '${lead.status === 'starred' ? 'active' : 'starred'}')" class="p-2 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Star Lead">
                        <i class="fas fa-star text-lg ${starIconClass} hover:text-yellow-500 transition-colors"></i>
                    </button>
                    <button onclick="updateLeadStatus('${lead.id}', 'archived')" class="p-2 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300 transition-colors" title="Archive Lead">
                        <i class="fas fa-archive text-lg"></i>
                    </button>
                </div>
            </div>

            <!-- Card Body -->
            <div class="py-4 flex-grow">
                <p class="text-gray-800 dark:text-gray-200 text-sm leading-relaxed">${highlightedText}</p>
            </div>

            <!-- AI Insights Section -->
            ${lead.analysis ? `
            <div class="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
                <div class="flex justify-between items-center text-sm">
                    <span class="text-gray-500 dark:text-gray-400">🔥 Buying Intent</span>
                    <span class="font-bold text-gray-800 dark:text-gray-200">${lead.analysis.intent_score || 'N/A'}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                    <span class="text-gray-500 dark:text-gray-400">👤 Customer Persona</span>
                    <span class="font-bold text-gray-800 dark:text-gray-200">${lead.analysis.customer_persona || 'N/A'}</span>
                </div>
                ${(lead.analysis.pain_points && Array.isArray(lead.analysis.pain_points) && lead.analysis.pain_points.length > 0) ? `
                <div>
                    <div class="flex flex-wrap gap-2">
                        ${lead.analysis.pain_points.map(point => `<span class="inline-block bg-blue-100 text-blue-800 text-xs font-medium mr-2 px-2.5 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">${point}</span>`).join('')}
                    </div>
                </div>
                ` : ''}
            </div>
            ` : ''}

            <!-- Card Footer -->
            <div class="mt-auto border-t border-gray-200 dark:border-gray-700 pt-4 flex justify-between items-center">
                <button onclick="getAiReply('${lead.id}', this)" class="text-sm px-4 py-2 rounded-lg font-semibold bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition">🤖 AI Reply</button>
                <a href="${lead.url}" target="_blank" class="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">View Post &rarr;</a>
            </div>

            <!-- AI Reply Container (hidden by default) -->
            <div id="reply-container-${lead.id}" class="hidden mt-4 space-y-2">
                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Suggested Reply</h4>
                <textarea id="reply-textarea-${lead.id}" class="w-full h-32 p-2 border rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500 text-sm" readonly></textarea>
                <button onclick="copyReply('${lead.id}')" class="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">Copy Reply</button>
            </div>
        </div>
        `;
        allLeadsHtml += leadHtml;
    });
    
    proFeed.innerHTML = allLeadsHtml;
    eliteFeed.innerHTML = allLeadsHtml;

    if (filteredLeads.length > leadsToShow) {
        const showMoreButton = `<button onclick="showMoreLeads()" class="w-full py-2 px-4 text-sm text-blue-600 dark:text-blue-400 font-semibold rounded-lg hover:bg-blue-50 dark:hover:bg-gray-700 transition col-span-full">Show More</button>`;
        if(proFeedFooter) proFeedFooter.innerHTML = showMoreButton;
        if(eliteFeedFooter) eliteFeedFooter.innerHTML = showMoreButton;
    }
}

function updateAnalytics(leads) {
    if (!leads) return; 
    
    if (leads.length === 0) {
        document.getElementById('pro-analytics-total-leads').textContent = 0;
        document.getElementById('pro-analytics-top-keyword').textContent = '-';
        document.getElementById('pro-analytics-top-platform').textContent = '-';
        if (activePage === 'analyticsPage' && currentUserPlan === 'elite') {
             renderAnalyticsCharts({ labels: [], data: [] }, { labels: [], data: [] });
        }
        return;
    };

    const now = new Date();
    const leadsThisMonth = leads.filter(lead =>
        lead.timestamp.getMonth() === now.getMonth() && lead.timestamp.getFullYear() === now.getFullYear()
    ).length;

    const keywordCounts = leads.reduce((acc, lead) => {
        const key = lead.keyword.toLowerCase();
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const topKeyword = Object.keys(keywordCounts).length > 0 ? Object.keys(keywordCounts).reduce((a, b) => keywordCounts[a] > keywordCounts[b] ? a : b) : '-';

    const platformCounts = leads.reduce((acc, lead) => {
        acc[lead.source] = (acc[lead.source] || 0) + 1;
        return acc;
    }, {});
    const topPlatform = Object.keys(platformCounts).length > 0 ? Object.keys(platformCounts).reduce((a, b) => platformCounts[a] > platformCounts[b] ? a : b) : '-';

    document.getElementById('pro-analytics-total-leads').textContent = leadsThisMonth;
    document.getElementById('pro-analytics-top-keyword').textContent = `"${topKeyword}"`;
    document.getElementById('pro-analytics-top-platform').textContent = topPlatform;

    if (activePage === 'analyticsPage' && currentUserPlan === 'elite') {
        const trendLabels = [...Array(30).keys()].map(i => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }).reverse();

        const trendDataPoints = Array(30).fill(0);
        leads.forEach(lead => {
            const diffDays = Math.floor((new Date() - lead.timestamp) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays < 30) {
                trendDataPoints[29 - diffDays]++;
            }
        });

        const trendData = { labels: trendLabels, data: trendDataPoints };
        const sourceData = { labels: Object.keys(platformCounts), data: Object.values(platformCounts) };
        renderAnalyticsCharts(trendData, sourceData);
    }
}

async function seedInitialData(userId) {
    const leadsQuery = db.collection('leads').where('userId', '==', userId).limit(1);
    const snapshot = await leadsQuery.get();
    if (snapshot.empty) {
        console.log("No leads found. Seeding a rich set of initial data for demonstration.");
        const batch = db.batch();
        const sampleLeads = [
            { 
                userId: userId, source: 'Reddit', keyword: 'CRM alternative', text: 'Does anyone know a good CRM alternative to Salesforce? We\'re a small team and find it way too complex.', url: '#', 
                timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)),
                status: 'active',
                analysis: {
                    summary: "A small team is seeking a less complex and more affordable alternative to Salesforce, indicating a need for user-friendly and budget-conscious CRM solutions.",
                    pain_points: ["Salesforce is too complex", "High cost for small teams"],
                    intent_score: "High",
                    customer_persona: "Small Business Owner",
                    mentioned_competitors: ["Salesforce"]
                }
            },
            { 
                userId: userId, source: 'X', keyword: 'project management tool', text: 'Looking for a simple project management tool. Jira is overkill for my personal projects. Suggestions?', url: '#', 
                timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
                status: 'starred',
                analysis: {
                    summary: "An individual developer or freelancer is looking for a simple, non-enterprise project management tool for personal use, finding Jira to be too feature-heavy.",
                    pain_points: ["Jira is too complex for personal use", "Needs a lightweight solution"],
                    intent_score: "Medium",
                    customer_persona: "Solo Developer/Freelancer",
                    mentioned_competitors: ["Jira"]
                }
            },
            { userId: userId, source: 'YouTube', keyword: 'best note taking app', text: 'Comment: I\'ve tried Evernote and Notion, but I\'m still searching for the best note taking app that has good offline support.', url: 'https://329974c44455.ngrok-free.app', timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000)), status: 'active' },
            { userId: userId, source: 'Facebook', keyword: 'used office chair', text: 'ISO a good quality used office chair, something like a Herman Miller or Steelcase. Budget is around $300.', url: 'https://329974c44455.ngrok-free.app', timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)), status: 'active' },
            { userId: userId, source: 'Reddit', keyword: 'project management tool', text: 'We need a new project management tool for our marketing team. Asana is getting expensive.', url: 'https://329974c44455.ngrok-free.app', timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)), status: 'active' },
            { userId: userId, source: 'Forum', keyword: 'photo editing software', text: 'What\'s a good one-time purchase photo editing software? Tired of Adobe subscriptions.', url: 'https://329974c44455.ngrok-free.app', timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), status: 'archived' },
            { userId: userId, source: 'X', keyword: 'CRM alternative', text: 'Anyone moved from HubSpot to a cheaper CRM alternative? Need recommendations!', url: 'https://329974c44455.ngrok-free.app', timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)), status: 'active' },
            { userId: userId, source: 'Reddit', keyword: 'best note taking app', text: 'I need the best note taking app for collaborative projects. Google Docs is not cutting it.', url: 'https://329974c44455.ngrok-free.app', timestamp: firebase.firestore.Timestamp.fromDate(new Date(Date.now() - 12 * 24 * 60 * 60 * 1000)), status: 'active' }
        ];
        sampleLeads.forEach(lead => {
            const docRef = db.collection('leads').doc();
            batch.set(docRef, lead);
        });
        await batch.commit();
    }
}

// --- FIXED: AI Reply & Copy Functionality ---

function copyReply(leadId) {
    const textArea = document.getElementById('reply-textarea-' + leadId);
    if (textArea && textArea.value) {
        textArea.select();
        textArea.setSelectionRange(0, 99999); // For mobile
        try {
            document.execCommand('copy');
            showNotification('Reply copied to clipboard!', 'success');
        } catch (err) {
            console.error('Copy to clipboard failed: ', err);
            showNotification('Failed to copy reply.', 'error');
        }
    }
}

async function getAiReply(leadId, buttonElement) {
    let lead = allLeads.find(l => l.id === leadId) || scanResultsLeads.find(l => l.id === leadId);

    if (!lead) {
        showNotification("Could not find lead data. Please refresh.", "error");
        return;
    }

    const user = auth.currentUser;
    if (!user) {
        showNotification("You must be logged in to use this feature.", "error");
        return;
    }

    const replyContainer = document.getElementById('reply-container-' + leadId);
    const replyTextArea = document.getElementById('reply-textarea-' + leadId);

    if (!replyContainer || !replyTextArea) {
        console.error("UI Error: Could not find reply container for lead ID:", leadId);
        showNotification("A UI error occurred. Please refresh.", "error");
        return;
    }
    
    buttonElement.innerText = "Generating...";
    buttonElement.disabled = true;

    try {
        const response = await fetch('http://127.0.0.1:4000/generate-reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_text: lead.text, userId: user.uid })
        });

        if (!response.ok) {
            throw new Error('The server responded with an error.');
        }

        const data = await response.json();
        
        replyTextArea.value = data.reply || "No suggestion available.";
        replyContainer.classList.remove('hidden');

    } catch (error) {
        console.error("Error fetching AI reply:", error);
        showNotification("Failed to get AI suggestion. Check console.", "error");
    } finally {
        buttonElement.innerText = "🤖 AI Reply";
        buttonElement.disabled = false;
    }
}

window.getAiReply = getAiReply;
window.copyReply = copyReply;

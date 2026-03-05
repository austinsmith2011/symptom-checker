const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let conversationHistory = [];
let followUpAnswers = {};

// --- Sections ---
const intakeSection = $('#intakeSection');
const loadingSection = $('#loadingSection');
const resultsSection = $('#resultsSection');
const errorSection = $('#errorSection');

function showSection(section) {
  [intakeSection, loadingSection, resultsSection, errorSection].forEach(s => s.classList.add('hidden'));
  section.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Collapsible Panels ---
function setupCollapsible(toggleId, panelId, chevronId) {
  const toggle = $(`#${toggleId}`);
  const panel = $(`#${panelId}`);
  const chevron = $(`#${chevronId}`);
  toggle.addEventListener('click', () => {
    const open = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    chevron.style.transform = open ? '' : 'rotate(180deg)';
  });
}
setupCollapsible('historyToggle', 'historyPanel', 'historyChevron');
setupCollapsible('lifestyleToggle', 'lifestylePanel', 'lifestyleChevron');

// --- Severity Slider ---
const severitySlider = $('#severity');
const severityValue = $('#severityValue');
severitySlider.addEventListener('input', () => {
  severityValue.textContent = severitySlider.value;
});

// --- Voice Input (Web Speech API) ---
const micBtn = $('#micBtn');
const micIcon = $('#micIcon');
const micDot = $('#micRecordingDot');
const micStatus = $('#micStatus');
const symptomsTextarea = $('#symptoms');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += t + ' ';
      } else {
        interim += t;
      }
    }
    const existing = symptomsTextarea.value.trimEnd();
    const base = existing && !existing.endsWith(finalTranscript.trimEnd())
      ? existing + ' '
      : '';
    symptomsTextarea.value = base + finalTranscript + interim;
  };

  recognition.onend = () => {
    if (isRecording) {
      recognition.start();
    }
  };

  recognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      stopRecording();
    }
  };

  micBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
} else {
  micBtn.classList.add('hidden');
}

function startRecording() {
  isRecording = true;
  recognition.start();
  micBtn.classList.add('recording');
  micDot.classList.remove('hidden');
  micStatus.classList.remove('hidden');
  micIcon.classList.remove('text-slate-500');
  micIcon.classList.add('text-red-500');
}

function stopRecording() {
  isRecording = false;
  recognition.stop();
  micBtn.classList.remove('recording');
  micDot.classList.add('hidden');
  micStatus.classList.add('hidden');
  micIcon.classList.remove('text-red-500');
  micIcon.classList.add('text-slate-500');
}

// --- Start Over ---
$('#startOverBtn').addEventListener('click', () => {
  conversationHistory = [];
  followUpAnswers = {};
  $('#intakeForm').reset();
  severityValue.textContent = '5';
  $('#startOverBtn').classList.add('hidden');
  if (isRecording) stopRecording();
  showSection(intakeSection);
});

$('#retryBtn').addEventListener('click', () => {
  showSection(intakeSection);
});

// --- Form Submission ---
$('#intakeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isRecording) stopRecording();

  const formData = {
    symptoms: $('#symptoms').value.trim(),
    age: $('#age').value,
    sex: $('#sex').value,
    height: $('#height').value,
    weight: $('#weight').value,
    duration: $('#duration').value,
    severity: $('#severity').value,
    bodyLocation: $('#bodyLocation').value,
    preExistingConditions: $('#preExistingConditions').value,
    medications: $('#medications').value,
    allergies: $('#allergies').value,
    recentTravel: $('#recentTravel').value,
    familyHistory: $('#familyHistory').value,
    smoking: $('#smoking').value,
    alcohol: $('#alcohol').value,
    exercise: $('#exercise').value,
  };

  if (!formData.symptoms) return;

  showSection(loadingSection);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    conversationHistory = json.conversationHistory;
    renderResults(json.data);
    $('#startOverBtn').classList.remove('hidden');
    showSection(resultsSection);
  } catch (err) {
    showError(err.message);
  }
});

// --- Follow-up ---
$('#followUpBtn').addEventListener('click', sendFollowUp);

async function sendFollowUp() {
  const answers = collectFollowUpAnswers();
  if (!answers) return;

  const btn = $('#followUpBtn');
  btn.disabled = true;
  btn.textContent = 'Analyzing...';

  showLoadingOnQuestions();

  try {
    const res = await fetch('/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationHistory, message: answers }),
    });

    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    conversationHistory = json.conversationHistory;
    followUpAnswers = {};
    renderResults(json.data);
    resultsSection.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Analysis';
  }
}

function collectFollowUpAnswers() {
  const parts = [];
  $$('[data-question-id]').forEach(card => {
    const qid = card.dataset.questionId;
    const question = card.dataset.questionText;
    const type = card.dataset.questionType;
    let answer = '';

    if (type === 'yes_no' || type === 'choice') {
      const selected = card.querySelector('.followup-option-btn.selected');
      if (selected) answer = selected.textContent.trim();
    } else if (type === 'scale') {
      const slider = card.querySelector('input[type="range"]');
      if (slider) answer = slider.value + '/10';
    } else if (type === 'text') {
      const input = card.querySelector('input[type="text"], textarea');
      if (input) answer = input.value.trim();
    }

    if (answer) {
      parts.push(`Q: ${question}\nA: ${answer}`);
    }
  });

  if (!parts.length) return null;
  return parts.join('\n\n');
}

function showLoadingOnQuestions() {
  const container = $('#followUpQuestions');
  container.innerHTML = `
    <div class="flex items-center justify-center py-8 gap-3">
      <div class="loading-spinner" style="width:24px;height:24px;border-width:3px;"></div>
      <span class="text-sm text-slate-500">Updating your assessment...</span>
    </div>`;
}

// --- Render Results ---
function renderResults(data) {
  renderEmergencyBanner(data.emergency);
  $('#summaryText').textContent = data.summary || '';
  renderConditions(data.conditions || []);
  renderFollowUpQuestions(data.followUpQuestions || []);
}

function renderEmergencyBanner(emergency) {
  const banner = $('#emergencyBanner');
  if (!emergency) { banner.classList.add('hidden'); return; }

  banner.classList.remove('hidden');
  const icon = $('#emergencyIcon');
  const title = $('#emergencyTitle');
  const msg = $('#emergencyMessage');

  const configs = {
    emergency: {
      bannerClass: 'bg-red-50 border-red-300',
      iconBg: 'bg-red-100',
      iconSvg: `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>`,
      titleClass: 'text-red-800',
      msgClass: 'text-red-700',
      titleText: 'Emergency — Seek Immediate Care',
    },
    urgent: {
      bannerClass: 'bg-orange-50 border-orange-300',
      iconBg: 'bg-orange-100',
      iconSvg: `<svg class="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      titleClass: 'text-orange-800',
      msgClass: 'text-orange-700',
      titleText: 'Urgent — See a Doctor Soon',
    },
    soon: {
      bannerClass: 'bg-yellow-50 border-yellow-300',
      iconBg: 'bg-yellow-100',
      iconSvg: `<svg class="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      titleClass: 'text-yellow-800',
      msgClass: 'text-yellow-700',
      titleText: 'Schedule a Visit',
    },
    routine: {
      bannerClass: 'bg-green-50 border-green-300',
      iconBg: 'bg-green-100',
      iconSvg: `<svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      titleClass: 'text-green-800',
      msgClass: 'text-green-700',
      titleText: 'Low Urgency',
    },
  };

  const level = emergency.urgencyLevel || 'routine';
  const cfg = configs[level] || configs.routine;

  banner.className = `rounded-2xl p-6 border-2 ${cfg.bannerClass}`;
  icon.className = `w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${cfg.iconBg}`;
  icon.innerHTML = cfg.iconSvg;
  title.className = `text-lg font-semibold mb-1 ${cfg.titleClass}`;
  title.textContent = cfg.titleText;
  msg.className = `text-sm ${cfg.msgClass}`;
  msg.textContent = emergency.message || '';
}

function renderConditions(conditions) {
  const grid = $('#conditionsGrid');
  grid.innerHTML = '';

  conditions.forEach((cond, i) => {
    const likelihoodColors = {
      high: 'bg-red-100 text-red-700',
      medium: 'bg-yellow-100 text-yellow-700',
      low: 'bg-green-100 text-green-700',
    };
    const badge = likelihoodColors[cond.likelihood] || likelihoodColors.medium;

    const card = document.createElement('div');
    card.className = 'condition-card bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden';
    card.innerHTML = `
      <button class="condition-header w-full px-6 py-5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors cursor-pointer" data-index="${i}">
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-2xl font-bold text-slate-300">${i + 1}</span>
          <div class="min-w-0">
            <h4 class="text-base font-semibold text-slate-800">${esc(cond.name)}</h4>
            <p class="text-sm text-slate-500 truncate">${esc(cond.description)}</p>
          </div>
        </div>
        <div class="flex items-center gap-3 shrink-0 ml-4">
          <span class="text-xs font-medium px-2.5 py-1 rounded-full ${badge}">${esc(cond.likelihood)} likelihood</span>
          <svg class="condition-chevron w-5 h-5 text-slate-400 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </button>
      <div class="condition-details hidden px-6 pb-6 space-y-4 border-t border-slate-100">
        <div class="pt-4">
          <h5 class="text-sm font-semibold text-slate-700 mb-1">Why this matches</h5>
          <p class="text-sm text-slate-600">${esc(cond.whyItMatches)}</p>
        </div>
        ${renderTreatments(cond.treatments)}
        <div>
          <h5 class="text-sm font-semibold text-slate-700 mb-1">When to see a doctor</h5>
          <p class="text-sm text-slate-600">${esc(cond.whenToSeeDoctor)}</p>
        </div>
        ${cond.redFlags && cond.redFlags.length ? `
        <div>
          <h5 class="text-sm font-semibold text-red-600 mb-2">Red flags to watch for</h5>
          <ul class="space-y-1">
            ${cond.redFlags.map(f => `<li class="flex items-start gap-2 text-sm text-red-700"><span class="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>${esc(f)}</li>`).join('')}
          </ul>
        </div>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });

  $$('.condition-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.condition-card');
      const details = card.querySelector('.condition-details');
      const chevron = card.querySelector('.condition-chevron');
      const isOpen = !details.classList.contains('hidden');
      details.classList.toggle('hidden');
      chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    });
  });
}

function renderTreatments(treatments) {
  if (!treatments) return '';
  const sections = [
    { key: 'immediate', label: 'What to do now' },
    { key: 'otc', label: 'Over-the-counter options' },
    { key: 'prescription', label: 'Prescription treatments' },
    { key: 'lifestyle', label: 'Lifestyle & home remedies' },
  ];
  const items = sections
    .filter(s => treatments[s.key])
    .map(s => `<li class="text-sm text-slate-600"><span class="font-medium text-slate-700">${s.label}:</span> ${esc(treatments[s.key])}</li>`)
    .join('');

  if (!items) return '';
  return `<div>
    <h5 class="text-sm font-semibold text-slate-700 mb-2">Treatment options</h5>
    <ul class="space-y-2">${items}</ul>
  </div>`;
}

// --- Interactive Follow-Up Questions ---
function renderFollowUpQuestions(questions) {
  const container = $('#followUpQuestions');
  container.innerHTML = '';
  followUpAnswers = {};

  const normalized = normalizeQuestions(questions);

  if (!normalized.length) {
    $('#followUpSection').classList.add('hidden');
    return;
  }

  $('#followUpSection').classList.remove('hidden');

  normalized.forEach((q, i) => {
    const card = document.createElement('div');
    card.className = 'bg-slate-50 rounded-xl p-4';
    card.dataset.questionId = `q${i}`;
    card.dataset.questionText = q.question;
    card.dataset.questionType = q.type;

    let inputHtml = '';

    if (q.type === 'yes_no') {
      inputHtml = `
        <div class="flex gap-2 mt-3">
          <button type="button" class="followup-option-btn" data-value="Yes">Yes</button>
          <button type="button" class="followup-option-btn" data-value="No">No</button>
        </div>`;
    } else if (q.type === 'choice' && q.options && q.options.length) {
      inputHtml = `
        <div class="flex flex-wrap gap-2 mt-3">
          ${q.options.map(opt => `<button type="button" class="followup-option-btn" data-value="${esc(opt)}">${esc(opt)}</button>`).join('')}
        </div>`;
    } else if (q.type === 'scale') {
      const minLabel = q.scaleMin || 'Low';
      const maxLabel = q.scaleMax || 'High';
      inputHtml = `
        <div class="mt-3">
          <input type="range" min="1" max="10" value="5" class="w-full accent-blue-600">
          <div class="flex justify-between text-xs text-slate-400 mt-1">
            <span>${esc(minLabel)}</span>
            <span class="followup-scale-value font-medium text-slate-600">5</span>
            <span>${esc(maxLabel)}</span>
          </div>
        </div>`;
    } else {
      inputHtml = `
        <div class="mt-3">
          <input type="text" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Type your answer...">
        </div>`;
    }

    card.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-slate-700">${esc(q.question)}</p>
          ${inputHtml}
        </div>
      </div>`;

    container.appendChild(card);
  });

  // Wire up option button selection (yes_no + choice)
  container.querySelectorAll('.followup-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const siblings = btn.parentElement.querySelectorAll('.followup-option-btn');
      siblings.forEach(s => s.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Wire up scale sliders
  container.querySelectorAll('input[type="range"]').forEach(slider => {
    const label = slider.parentElement.querySelector('.followup-scale-value');
    slider.addEventListener('input', () => {
      if (label) label.textContent = slider.value;
    });
  });
}

function normalizeQuestions(questions) {
  if (!questions || !questions.length) return [];

  return questions.map(q => {
    if (typeof q === 'string') {
      return { question: q, type: 'text' };
    }
    return {
      question: q.question || '',
      type: q.type || 'text',
      options: q.options || [],
      scaleMin: q.scaleMin || '',
      scaleMax: q.scaleMax || '',
    };
  });
}

// --- Error ---
function showError(message) {
  $('#errorMessage').textContent = message || 'An unexpected error occurred. Please try again.';
  showSection(errorSection);
}

// --- Utility ---
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

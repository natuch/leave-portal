/**
 * Leave Management System - Main Application Controller (app.js)
 * -------------------------------------------------------------
 * จัดการส่วนติดต่อผู้ใช้, LocalStorage, การซิงค์ Google Sheets,
 * การเรียกใช้ Gemini API, และการวิเคราะห์คำสั่งภาษาไทย/คำสั่งเสียง
 */

// --- GLOBAL STATE ---
const state = {
  leaves: [],       // รายการวันลาที่บันทึก
  settings: {
    sheetUrl: '',   // URL Google Apps Script Web App
    geminiKey: ''   // Gemini API Key
  },
  currentView: 'dashboard',
  speechRecognition: null,
  activeLeaveType: 'ลาป่วย', // ค่าเริ่มต้นสำหรับฟอร์ม
  charts: {
    pie: null,
    bar: null
  }
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  loadLocalStorage();
  initNavigation();
  initFormController();
  initSpeechRecognition();
  initSettingsController();
  initAIChat();
  
  // อัปเดตการแสดงผลและกราฟครั้งแรก
  updateDashboard();
  checkConnectionStatus();
  
  // ซิงค์ข้อมูลอัตโนมัติหากมีอินเทอร์เน็ตและมีข้อมูลค้างอยู่
  if (navigator.onLine) {
    syncPendingData();
  }
  
  // ตรวจจับสถานะการเชื่อมต่ออินเทอร์เน็ต
  window.addEventListener('online', () => {
    showToast('เชื่อมต่ออินเทอร์เน็ตแล้ว', 'success');
    syncPendingData();
  });
  window.addEventListener('offline', () => {
    showToast('คุณอยู่ในโหมดออฟไลน์ ข้อมูลจะเก็บในเครื่องก่อน', 'warning');
  });
}

// --- LOCAL STORAGE ---
function loadLocalStorage() {
  const storedLeaves = localStorage.getItem('leave_records');
  const storedSettings = localStorage.getItem('leave_settings');
  
  if (storedLeaves) {
    state.leaves = JSON.parse(storedLeaves);
  }
  if (storedSettings) {
    state.settings = JSON.parse(storedSettings);
  }
}

function saveLeavesToLocalStorage() {
  localStorage.setItem('leave_records', JSON.stringify(state.leaves));
}

function saveSettingsToLocalStorage() {
  localStorage.setItem('leave_settings', JSON.stringify(state.settings));
}

// --- NAVIGATION & VIEW SWITCHER ---
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn, .mobile-nav-btn');
  
  navButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const viewName = btn.getAttribute('data-view');
      switchView(viewName);
    });
  });
}

function switchView(viewName) {
  state.currentView = viewName;
  
  // ซ่อน/แสดง Views
  document.querySelectorAll('.app-view').forEach(view => {
    view.classList.remove('active');
  });
  const targetView = document.getElementById(`${viewName}-view`);
  if (targetView) targetView.classList.add('active');
  
  // สลับสถานะปุ่มนำทาง (ทั้ง Desktop และ Mobile)
  document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(btn => {
    if (btn.getAttribute('data-view') === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // ถ้าเปลี่ยนกลับมาหน้า Dashboard ให้วาดกราฟใหม่
  if (viewName === 'dashboard') {
    updateDashboard();
  }
}

// --- FORM CONTROLLER (LEAVE REQUEST) ---
function initFormController() {
  const form = document.getElementById('leave-form');
  const typeCards = document.querySelectorAll('.type-card');
  const isRangeToggle = document.getElementById('is-range');
  const endDateGroup = document.getElementById('end-date-group');
  
  // สลับประเภทการลา (ลาป่วย, ลากิจ, ฯลฯ) ผ่าน Chip Cards
  typeCards.forEach(card => {
    card.addEventListener('click', () => {
      typeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      state.activeLeaveType = card.getAttribute('data-type');
      updateTicketPreview();
    });
  });
  
  // สลับฟิลด์วันเริ่มต้น - สิ้นสุด
  isRangeToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      endDateGroup.style.display = 'block';
    } else {
      endDateGroup.style.display = 'none';
      document.getElementById('end-date').value = '';
    }
    updateTicketPreview();
  });
  
  // คอยตรวจจับการกรอกเพื่ออัปเดตตั๋วตัวอย่าง (Live Ticket Preview)
  const inputs = ['name', 'start-date', 'end-date', 'reason'];
  inputs.forEach(id => {
    document.getElementById(id).addEventListener('input', updateTicketPreview);
  });
  
  // การ Submit แบบฟอร์ม
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('name').value.trim();
    const startDateStr = document.getElementById('start-date').value;
    const isRange = isRangeToggle.checked;
    const endDateStr = isRange ? document.getElementById('end-date').value : '';
    const reason = document.getElementById('reason').value.trim();
    
    if (!name || !startDateStr) {
      showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน', 'warning');
      return;
    }
    
    if (isRange && !endDateStr) {
      showToast('กรุณาระบุวันสิ้นสุดการลา', 'warning');
      return;
    }
    
    // แตกช่วงวันที่ (Date Splitting)
    const dates = splitDateRange(startDateStr, isRange ? endDateStr : startDateStr);
    
    if (dates.length === 0) {
      showToast('ช่วงวันที่ไม่ถูกต้อง วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น', 'error');
      return;
    }
    
    // สร้างรายการข้อมูลสำหรับจัดเก็บ
    const newRecords = dates.map(date => ({
      id: generateId(),
      name: name,
      date: date,
      type: state.activeLeaveType,
      reason: reason || '',
      synced: false,
      timestamp: new Date().toISOString()
    }));
    
    // บันทึกลงเครื่องก่อน
    state.leaves.push(...newRecords);
    saveLeavesToLocalStorage();
    
    showToast(`บันทึกการลา ${dates.length} วันเรียบร้อยแล้ว (ออฟไลน์)`, 'info');
    
    // ล้างฟอร์ม
    form.reset();
    typeCards.forEach(c => c.classList.remove('active'));
    document.querySelector('.type-card[data-type="ลาป่วย"]').classList.add('active');
    state.activeLeaveType = 'ลาป่วย';
    endDateGroup.style.display = 'none';
    isRangeToggle.checked = false;
    updateTicketPreview();
    
    // ส่งเข้าระบบคลาวด์ (Google Sheets)
    await syncPendingData();
    updateDashboard();
  });
  
  // ปุ่มสำหรับ AI Quick-Fill
  document.getElementById('ai-fill-submit').addEventListener('click', () => {
    const text = document.getElementById('ai-fill-text').value.trim();
    if (text) {
      processAIQuickFill(text);
    } else {
      showToast('กรุณากรอกข้อความเพื่อส่งให้ AI', 'warning');
    }
  });
}

// อัปเดตตั๋วตัวอย่างแบบเรียลไทม์ (Live Ticket Preview)
function updateTicketPreview() {
  const name = document.getElementById('name').value.trim() || 'ชื่อพนักงาน';
  const startDateVal = document.getElementById('start-date').value;
  const isRange = document.getElementById('is-range').checked;
  const endDateVal = document.getElementById('end-date').value;
  const reason = document.getElementById('reason').value.trim() || 'ไม่มีระบุ';
  
  document.getElementById('preview-name').textContent = name;
  document.getElementById('preview-type').textContent = state.activeLeaveType;
  
  // จัดประเภทสีการ์ดตามประเภทลา
  const ticket = document.getElementById('ticket');
  ticket.style.borderColor = 'var(--glass-border)';
  if (state.activeLeaveType === 'ลาป่วย') ticket.style.boxShadow = '0 8px 32px 0 rgba(244, 63, 94, 0.15)';
  else if (state.activeLeaveType === 'ลากิจ') ticket.style.boxShadow = '0 8px 32px 0 rgba(59, 130, 246, 0.15)';
  else if (state.activeLeaveType === 'ลาฉุกเฉิน') ticket.style.boxShadow = '0 8px 32px 0 rgba(249, 115, 22, 0.15)';
  else if (state.activeLeaveType === 'ลาพักร้อน') ticket.style.boxShadow = '0 8px 32px 0 rgba(16, 185, 129, 0.15)';

  // แสดงผลวันที่บนตั๋ว
  if (startDateVal) {
    document.getElementById('preview-start-date').textContent = formatThaiDate(startDateVal);
    if (isRange && endDateVal) {
      document.getElementById('preview-end-date').textContent = formatThaiDate(endDateVal);
      const days = splitDateRange(startDateVal, endDateVal).length;
      document.getElementById('preview-days').textContent = `${days} วัน`;
      document.getElementById('preview-days-badge').style.display = 'block';
    } else {
      document.getElementById('preview-end-date').textContent = '-';
      document.getElementById('preview-days').textContent = '1 วัน';
      document.getElementById('preview-days-badge').style.display = 'block';
    }
  } else {
    document.getElementById('preview-start-date').textContent = 'ระบุวันที่';
    document.getElementById('preview-end-date').textContent = '-';
    document.getElementById('preview-days-badge').style.display = 'none';
  }
  
  document.getElementById('preview-reason').textContent = reason;
}

// --- DATE RANGE SPLITTING LOGIC ---
function splitDateRange(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const dates = [];
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return [];
  }
  
  if (start > end) {
    return [];
  }
  
  let current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

// --- GOOGLE SHEETS CONNECTION & SYNC ---
async function syncPendingData() {
  if (!state.settings.sheetUrl) {
    return;
  }
  
  const pendingRecords = state.leaves.filter(r => !r.synced);
  if (pendingRecords.length === 0) return;
  
  checkConnectionStatus();
  
  try {
    // ส่งข้อมูลแบบอาเรย์ของแถวไปยัง Web App
    const response = await fetch(state.settings.sheetUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // ป้องกัน CORS Preflight
      },
      body: JSON.stringify(pendingRecords)
    });
    
    const result = await response.json();
    if (result.status === 'success') {
      // ทำเครื่องหมายทุกข้อมูลที่ได้รับการซิงค์แล้ว
      pendingRecords.forEach(r => r.synced = true);
      saveLeavesToLocalStorage();
      showToast('ซิงค์ข้อมูลกับ Google Sheet สำเร็จ!', 'success');
      updateDashboard();
      updateConnectionStatus(true);
    } else {
      console.error(result.message);
      updateConnectionStatus(false);
    }
  } catch (error) {
    console.error('Sheet Sync Error:', error);
    updateConnectionStatus(false);
  }
}

async function testSheetConnection(url) {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: 'GET' });
    const result = await response.json();
    return result.status === 'success';
  } catch (error) {
    console.error('Test Connection Error:', error);
    return false;
  }
}

function checkConnectionStatus() {
  if (!state.settings.sheetUrl) {
    updateConnectionStatus(false);
    return;
  }
  
  testSheetConnection(state.settings.sheetUrl).then(connected => {
    updateConnectionStatus(connected);
  });
}

function updateConnectionStatus(isConnected) {
  const dots = document.querySelectorAll('.connection-dot');
  const texts = document.querySelectorAll('.connection-text');
  
  dots.forEach(dot => {
    if (isConnected) {
      dot.classList.add('connected');
    } else {
      dot.classList.remove('connected');
    }
  });
  
  texts.forEach(text => {
    text.textContent = isConnected ? 'เชื่อมต่อชีตแล้ว' : 'ไม่ได้เชื่อมต่อ Google Sheet';
  });
}

// --- SETTINGS VIEW CONTROLLER ---
function initSettingsController() {
  const sheetInput = document.getElementById('sheet-url-input');
  const keyInput = document.getElementById('gemini-key-input');
  
  // ใส่ค่าเดิมลงฟิลด์
  if (state.settings.sheetUrl) sheetInput.value = state.settings.sheetUrl;
  if (state.settings.geminiKey) keyInput.value = state.settings.geminiKey;
  
  // ปุ่มบันทึกการตั้งค่า
  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const url = sheetInput.value.trim();
    const key = keyInput.value.trim();
    
    state.settings.sheetUrl = url;
    state.settings.geminiKey = key;
    
    saveSettingsToLocalStorage();
    showToast('บันทึกการตั้งค่าแล้ว!', 'success');
    
    // ทดสอบการเชื่อมต่อ Google Sheets ทันทีหลังบันทึก
    if (url) {
      showToast('กำลังทดสอบการเชื่อมต่อ Google Sheet...', 'info');
      const connected = await testSheetConnection(url);
      if (connected) {
        showToast('เชื่อมต่อ Google Sheets สำเร็จ!', 'success');
        updateConnectionStatus(true);
        // ลองส่งข้อมูลที่ยังไม่ซิงค์
        syncPendingData();
      } else {
        showToast('ไม่สามารถเชื่อมต่อได้ กรุณาตรวจสอบ URL หรือสิทธิ์ใน Apps Script', 'error');
        updateConnectionStatus(false);
      }
    }
  });
}

// --- SPEECH RECOGNITION (Web Speech API) ---
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('Speech Recognition is not supported by this browser.');
    // ซ่อนปุ่มไมค์หรือปิดการใช้งานในกรณีที่ไม่รองรับ
    document.querySelectorAll('.ai-mic-btn, .chat-mic-btn').forEach(btn => {
      btn.style.display = 'none';
    });
    return;
  }
  
  state.speechRecognition = new SpeechRecognition();
  state.speechRecognition.continuous = false;
  state.speechRecognition.lang = 'th-TH'; // เน้นพูดภาษาไทย
  state.speechRecognition.interimResults = false;
  
  // ฟังก์ชันสลับการบันทึกเสียงฝั่ง Quick-Fill
  const aiMicBtn = document.getElementById('ai-mic-btn');
  const aiInput = document.getElementById('ai-fill-text');
  
  aiMicBtn.addEventListener('click', () => {
    if (aiMicBtn.classList.contains('listening')) {
      state.speechRecognition.stop();
    } else {
      startListening(aiMicBtn, aiInput);
    }
  });
  
  // ฟังก์ชันสลับการบันทึกเสียงฝั่ง AI Chatbot
  const chatMicBtn = document.getElementById('chat-mic-btn');
  const chatInput = document.getElementById('chat-input-field');
  
  chatMicBtn.addEventListener('click', () => {
    if (chatMicBtn.classList.contains('listening')) {
      state.speechRecognition.stop();
    } else {
      startListening(chatMicBtn, chatInput);
    }
  });
}

function startListening(button, inputField) {
  // ยกเลิกการแอดอีเวนท์เสียงที่ค้างอยู่
  state.speechRecognition.onstart = null;
  state.speechRecognition.onresult = null;
  state.speechRecognition.onerror = null;
  state.speechRecognition.onend = null;
  
  state.speechRecognition.onstart = () => {
    button.classList.add('listening');
    showToast('กำลังรับเสียงพูด... กรุณาพูดประโยคการลาของคุณ', 'info');
  };
  
  state.speechRecognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    inputField.value = transcript;
    showToast('ตรวจจับเสียงพูดสำเร็จ!', 'success');
  };
  
  state.speechRecognition.onerror = (event) => {
    console.error('Speech Recognition error:', event.error);
    showToast('การรับเสียงเกิดข้อผิดพลาด: ' + event.error, 'error');
    button.classList.remove('listening');
  };
  
  state.speechRecognition.onend = () => {
    button.classList.remove('listening');
  };
  
  state.speechRecognition.start();
}

// --- CLIENT-SIDE GEMINI API INTEGRATION & fallback ---
async function processAIQuickFill(text) {
  const card = document.querySelector('.ai-quick-fill-card');
  card.classList.add('processing');
  
  showToast('AI กำลังวิเคราะห์ข้อมูลการลา...', 'info');
  
  let parsedData = null;
  
  if (state.settings.geminiKey) {
    parsedData = await fetchLeaveDetailsFromGemini(text);
  } else {
    // ระบบ Fallback ประมวลภาษาในเครื่อง (Regex-based NLP)
    parsedData = runLocalFallbackParser(text);
    showToast('ใช้ระบบวิเคราะห์ภายใน (ต้องการความถูกต้องเต็มที่ แนะนำให้ใส่ Gemini API Key ในหน้าตั้งค่า)', 'warning');
  }
  
  card.classList.remove('processing');
  
  if (parsedData) {
    // เติมข้อมูลลงฟอร์ม
    fillFormWithData(parsedData);
  } else {
    showToast('ไม่สามารถแกะวิเคราะห์ประโยคนี้ได้ กรุณากรอกแบบฟอร์มด้วยตนเองครับ', 'error');
  }
}

// เรียกดึงข้อมูลผ่านโมเดล Gemini API
async function fetchLeaveDetailsFromGemini(text) {
  const key = state.settings.geminiKey;
  const currentYear = new Date().getFullYear();
  const currentDateStr = new Date().toISOString().split('T')[0];
  
  // Prompt สำหรับแยกข้อมูลการลา
  const systemPrompt = `You are a data extractor. You must analyze the text input and extract details for a leave request database. 
Return ONLY a valid JSON object without any markdown wrapping (no \`\`\`json) and no other text.
The JSON structure must be:
{
  "name": "Employee name (string or null)",
  "startDate": "Start date of leave (format YYYY-MM-DD or null)",
  "endDate": "End date of leave (format YYYY-MM-DD or null)",
  "type": "Leave type, MUST be one of: 'ลาป่วย', 'ลากิจ', 'ลาฉุกเฉิน', 'ลาพักร้อน' or null",
  "reason": "Reason for leave (string, empty string or null)"
}

Rules:
- Current date is ${currentDateStr} (Year ${currentYear}).
- Extract date ranges correctly. (e.g. "5 - 7 มิถุนายน" -> startDate is "${currentYear}-06-05", endDate is "${currentYear}-06-07").
- If months are given in English (e.g. "June"), convert to correct month index ("06").
- If only a single date is specified (e.g. "5 June"), startDate and endDate must be the same.
- Parse standard Thai leave types: "Sick" -> "ลาป่วย", "Personal" -> "ลากิจ", "Emergency" -> "ลาฉุกเฉิน", "Vacation/Holiday" -> "ลาพักร้อน".
- The output MUST be strictly a JSON string, nothing else.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\nInput text to extract: "${text}"` }]
          }
        ]
      })
    });
    
    const resJson = await response.json();
    let replyText = resJson.candidates[0].content.parts[0].text.trim();
    
    // ลบ Markdown backticks เผื่อโมเดลคืนค่ามา
    replyText = replyText.replace(/^```json/i, '').replace(/```$/, '').trim();
    
    const parsed = JSON.parse(replyText);
    return parsed;
  } catch (error) {
    console.error('Gemini API Error:', error);
    showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ Gemini API', 'error');
    return null;
  }
}

// ระบบแกะข้อความด้วย Regular Expressions ภาษาไทย (Local Rule-based NLP)
function runLocalFallbackParser(text) {
  const parsed = {
    name: null,
    startDate: null,
    endDate: null,
    type: 'ลาป่วย',
    reason: ''
  };
  
  // 1. ตรวจจับประเภทการลา
  if (text.includes('ป่วย') || text.includes('sick')) {
    parsed.type = 'ลาป่วย';
  } else if (text.includes('กิจ') || text.includes('ลากิจ') || text.includes('personal')) {
    parsed.type = 'ลากิจ';
  } else if (text.includes('ฉุกเฉิน') || text.includes('emergency')) {
    parsed.type = 'ลาฉุกเฉิน';
  } else if (text.includes('พักร้อน') || text.includes('พักผ่อน') || text.includes(' vacation') || text.includes('holiday')) {
    parsed.type = 'ลาพักร้อน';
  }
  
  // 2. แกะชื่อ (หาคำนำหน้า)
  // สมมติว่าพยางค์แรกๆ ของข้อความเป็นชื่อคน เช่น "ณธัฏฑ์ลาพักร้อน 5 - 7 มิถุนายน"
  const nameMatch = text.match(/^([ก-๙a-zA-Z]+)(?:ลา|\s|ป่วย|กิจ)/);
  if (nameMatch && nameMatch[1]) {
    parsed.name = nameMatch[1];
  }
  
  // 3. แกะวันที่ลา
  // ค้นหารูปแบบวันลาเช่น "5 - 7 June", "5-7 มิถุนายน", "5 มิถุนายน", "5 June"
  const currentYear = new Date().getFullYear();
  const monthsTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const monthsAbbrTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthsEN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthsAbbrEN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  // หาดัชนีเดือนจากข้อความ
  let monthIndex = -1; // 0-11
  let foundMonthStr = '';
  
  const lowerText = text.toLowerCase();
  
  // หาเดือน
  for (let i = 0; i < 12; i++) {
    if (lowerText.includes(monthsTH[i])) { monthIndex = i; foundMonthStr = monthsTH[i]; break; }
    if (lowerText.includes(monthsAbbrTH[i])) { monthIndex = i; foundMonthStr = monthsAbbrTH[i]; break; }
    if (lowerText.includes(monthsEN[i])) { monthIndex = i; foundMonthStr = monthsEN[i]; break; }
    if (lowerText.includes(monthsAbbrEN[i])) { monthIndex = i; foundMonthStr = monthsAbbrEN[i]; break; }
  }
  
  if (monthIndex !== -1) {
    // ค้นหาวันที่ เช่น "5-7" หรือ "5 - 7" หรือ "5"
    // มองหาตัวเลขที่อยู่ใกล้ๆ คำว่าเดือน
    const dateRangeMatch = text.match(/(\d+)\s*(?:-|ถึง|จนถึง)\s*(\d+)/); // รูปแบบช่วงวันที่
    const singleDateMatch = text.match(/(\d+)/); // รูปแบบวันเดียว
    
    const formattedMonth = String(monthIndex + 1).padStart(2, '0');
    
    if (dateRangeMatch && dateRangeMatch[1] && dateRangeMatch[2]) {
      const startDay = String(dateRangeMatch[1]).padStart(2, '0');
      const endDay = String(dateRangeMatch[2]).padStart(2, '0');
      parsed.startDate = `${currentYear}-${formattedMonth}-${startDay}`;
      parsed.endDate = `${currentYear}-${formattedMonth}-${endDay}`;
    } else if (singleDateMatch && singleDateMatch[1]) {
      const day = String(singleDateMatch[1]).padStart(2, '0');
      parsed.startDate = `${currentYear}-${formattedMonth}-${day}`;
      parsed.endDate = `${currentYear}-${formattedMonth}-${day}`;
    }
  } else {
    // ดึงวันที่วันนี้มาใส่แทนเป็นตัวเลือกเริ่มต้นกรณีแกะไม่เจอเลย
    const today = new Date().toISOString().split('T')[0];
    parsed.startDate = today;
    parsed.endDate = today;
  }
  
  // 4. แกะเหตุผล (ถ้าเจอคำว่า "เพราะ" หรือ "เนื่องจาก" หรือ "เหตุผล")
  const reasonMatch = text.match(/(?:เพราะ|เนื่องจาก|เหตุผล|เนื่องจากลาเนื่องใน)\s*(.+)$/);
  if (reasonMatch && reasonMatch[1]) {
    parsed.reason = reasonMatch[1].trim();
  }
  
  return parsed;
}

// เอาข้อมูล JSON เติมลงหน้าฟอร์มพร้อมเอฟเฟกต์แอนิเมชัน
function fillFormWithData(data) {
  const nameField = document.getElementById('name');
  const startDateField = document.getElementById('start-date');
  const endDateField = document.getElementById('end-date');
  const isRangeToggle = document.getElementById('is-range');
  const endDateGroup = document.getElementById('end-date-group');
  const reasonField = document.getElementById('reason');
  const typeCards = document.querySelectorAll('.type-card');
  
  // 1. เติมชื่อ
  if (data.name) {
    nameField.value = data.name;
    nameField.classList.add('ai-autofilled');
    setTimeout(() => nameField.classList.remove('ai-autofilled'), 3000);
  }
  
  // 2. ตั้งค่าช่วงวันที่
  if (data.startDate) {
    startDateField.value = data.startDate;
    startDateField.classList.add('ai-autofilled');
    setTimeout(() => startDateField.classList.remove('ai-autofilled'), 3000);
    
    if (data.endDate && data.endDate !== data.startDate) {
      isRangeToggle.checked = true;
      endDateGroup.style.display = 'block';
      endDateField.value = data.endDate;
      endDateField.classList.add('ai-autofilled');
      setTimeout(() => endDateField.classList.remove('ai-autofilled'), 3000);
    } else {
      isRangeToggle.checked = false;
      endDateGroup.style.display = 'none';
      endDateField.value = '';
    }
  }
  
  // 3. เลือกประเภทการลา
  if (data.type) {
    state.activeLeaveType = data.type;
    typeCards.forEach(c => {
      if (c.getAttribute('data-type') === data.type) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });
  }
  
  // 4. เติมเหตุผล
  if (data.reason) {
    reasonField.value = data.reason;
    reasonField.classList.add('ai-autofilled');
    setTimeout(() => reasonField.classList.remove('ai-autofilled'), 3000);
  }
  
  // ปรับการแสดงผลบัตรจำลอง
  updateTicketPreview();
  showToast('AI นำข้อมูลกรอกลงแบบฟอร์มเรียบร้อยแล้ว! กรุณาตรวจสอบแล้วกดบันทึกข้อมูลครับ', 'success');
}

// --- AI CHATBOT SYSTEM (DASHBOARD Q&A) ---
function initAIChat() {
  const sendBtn = document.getElementById('chat-send-btn');
  const chatInput = document.getElementById('chat-input-field');
  const messagesWrapper = document.getElementById('chat-messages');
  const suggestedChips = document.querySelectorAll('.suggested-chip');
  
  // ส่งคำถามด้วยคลิกปุ่ม
  sendBtn.addEventListener('click', () => {
    const text = chatInput.value.trim();
    if (text) {
      handleUserChatQuery(text);
    }
  });
  
  // ส่งคำถามด้วยปุ่ม Enter
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) {
        handleUserChatQuery(text);
      }
    }
  });
  
  // คำถามล่วงหน้าที่คลิกปุ่มชิปได้
  suggestedChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const query = chip.textContent.trim();
      handleUserChatQuery(query);
    });
  });
}

async function handleUserChatQuery(query) {
  const chatInput = document.getElementById('chat-input-field');
  chatInput.value = ''; // ล้างช่องป้อน
  
  // 1. แสดงกล่องคำถามของ User
  appendChatBubble(query, 'user');
  
  // 2. แสดงสถานะกำลังคิดพิมพ์ข้อความ (Typing indicator)
  const typingIndicatorId = appendTypingIndicator();
  
  // 3. ประมวลผลคำตอบ
  let reply = '';
  
  if (state.settings.geminiKey) {
    reply = await getChatResponseFromGemini(query);
  } else {
    // Fallback แชทบอทวิเคราะห์แบบง่ายในเครื่อง
    reply = runLocalChatFallback(query);
  }
  
  // 4. เอาตัวพิมพ์ออกแล้วแสดงคำตอบจากบอท
  removeTypingIndicator(typingIndicatorId);
  appendChatBubble(reply, 'bot');
}

function appendChatBubble(text, sender) {
  const messagesWrapper = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${sender}`;
  
  // ประยุกต์แปลงการเคาะบรรทัดเป็น <br> และฟอร์แมตตัวหนา **text** ด้วย regex ง่ายๆ
  let formattedText = text
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
    
  bubble.innerHTML = formattedText;
  messagesWrapper.appendChild(bubble);
  
  // เลื่อนหน้าจอลงไปข้างล่างสุด
  messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
}

function appendTypingIndicator() {
  const messagesWrapper = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  const uniqueId = 'typing-' + Date.now();
  bubble.id = uniqueId;
  bubble.className = 'chat-bubble bot';
  
  bubble.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  
  messagesWrapper.appendChild(bubble);
  messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
  return uniqueId;
}

function removeTypingIndicator(id) {
  const element = document.getElementById(id);
  if (element) {
    element.remove();
  }
}

// บอทวิเคราะห์คำตอบจาก Gemini
async function getChatResponseFromGemini(query) {
  const key = state.settings.geminiKey;
  const currentYear = new Date().getFullYear();
  const currentDateStr = new Date().toISOString().split('T')[0];
  
  // ส่งข้อมูลฐานข้อมูลจำลอง (Leaves)
  const leavesCtx = state.leaves.map(l => ({
    name: l.name,
    date: l.date,
    type: l.type,
    reason: l.reason
  }));
  
  const systemPrompt = `You are a helpful Leave Dashboard Assistant for a company. 
Today's date is ${currentDateStr} (Year ${currentYear}).
Below is the current leave database in JSON format:
${JSON.stringify(leavesCtx)}

Answer the user's question accurately based ONLY on the provided leave database. 
Rules:
- Speak politely in Thai ("ครับ/ค่ะ").
- Be concise and clear.
- Use markdown formatting (bolding, bullet points) to present information nicely.
- If asked about "วันนี้ใครลาบ้าง", list the employees whose leave date matches ${currentDateStr}.
- If asked about "สัปดาห์นี้" or other relative dates, filter the JSON data appropriately using ${currentDateStr} as the reference today date.
- If asked about someone's total sick leaves, filter by their name and type "ลาป่วย" and count the days.
- If you don't know or the data is not in the JSON database, reply politely saying no record matches.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\nUser Question: "${query}"` }]
          }
        ]
      })
    });
    
    const resJson = await response.json();
    return resJson.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    console.error('Chat Gemini Error:', error);
    return 'ขออภัยด้วยครับ เชื่อมต่อ Gemini API ไม่สำเร็จ โปรดตรวจสอบสิทธิ์อินเทอร์เน็ตหรือคีย์การใช้งานในหน้าตั้งค่าก่อนนะครับ';
  }
}

// แชทบอทประมวลผลคำตอบแบบ Rule-Based ภาษาไทยในเครื่อง
function runLocalChatFallback(query) {
  const today = new Date().toISOString().split('T')[0];
  const lowerQuery = query.toLowerCase();
  
  // 1. วันนี้ใครลาบ้าง
  if (lowerQuery.includes('วันนี้') && lowerQuery.includes('ใครลา')) {
    const todayLeaves = state.leaves.filter(l => l.date === today);
    if (todayLeaves.length === 0) {
      return `จากการตรวจสอบวันนี้ (**${formatThaiDate(today)}**) **ไม่มีพนักงานลางาน** ครับ 🎉`;
    }
    
    let reply = `วันนี้ (**${formatThaiDate(today)}**) มีผู้ลางานทั้งหมด **${todayLeaves.length} ท่าน** ดังนี้ครับ:<br>`;
    todayLeaves.forEach((l, i) => {
      reply += `${i+1}. **${l.name}** - ${l.type} ${l.reason ? `(${l.reason})` : ''}<br>`;
    });
    return reply;
  }
  
  // 2. วิเคราะห์วันลาแยกเป็นคนๆ
  // ค้นหาข้อความแบบ "สถิติของ [ชื่อ]" หรือถามถึงชื่อคนใดคนหนึ่ง
  let foundName = null;
  state.leaves.forEach(l => {
    if (query.includes(l.name)) {
      foundName = l.name;
    }
  });
  
  if (foundName) {
    const personLeaves = state.leaves.filter(l => l.name === foundName);
    
    // นับแยกแต่ละแบบ
    const sickCount = personLeaves.filter(l => l.type === 'ลาป่วย').length;
    const personalCount = personLeaves.filter(l => l.type === 'ลากิจ').length;
    const emergencyCount = personLeaves.filter(l => l.type === 'ลาฉุกเฉิน').length;
    const vacationCount = personLeaves.filter(l => l.type === 'ลาพักร้อน').length;
    
    let reply = `สถิติการลาของคุณ **${foundName}** ในระบบเบื้องต้น:<br>`;
    reply += `* 🤒 **ลาป่วย**: ${sickCount} วัน<br>`;
    reply += `* 📁 **ลากิจ**: ${personalCount} วัน<br>`;
    reply += `* 🚨 **ลาฉุกเฉิน**: ${emergencyCount} วัน<br>`;
    reply += `* 🌴 **ลาพักร้อน**: ${vacationCount} วัน<br>`;
    reply += `รวมยอดการลาทั้งหมด **${personLeaves.length} วัน** ครับ`;
    
    return reply;
  }
  
  // 3. ตอบคำถามอื่นๆ ด้วยความรู้สึกลื่นไหลทั่วไป
  return `สวัสดีครับ! ผมเป็นผู้ช่วยข้อมูลการลาในเครื่องของคุณ 💻<br>
คุณสามารถสอบถามข้อมูลเบื้องต้นเกี่ยวกับฐานข้อมูลในปัจจุบันได้ เช่นพิมพ์ถาม **"วันนี้ใครลาบ้าง"** หรือถามชื่อพนักงานได้เลยครับ<br><br>
*(แนะนำเพิ่มเติม: ใส่ **Gemini API Key** ในหน้าตั้งค่า เพื่อให้ผมตอบคำถามที่ซับซ้อนและพูดคุยอย่างอิสระขึ้นได้ครับ)*`;
}

// --- DASHBOARD DATA & CHARTS ---
function updateDashboard() {
  // 1. นับสถิติตัวเลข
  const stats = {
    sick: 0,
    personal: 0,
    emergency: 0,
    vacation: 0
  };
  
  state.leaves.forEach(record => {
    if (record.type === 'ลาป่วย') stats.sick++;
    else if (record.type === 'ลากิจ') stats.personal++;
    else if (record.type === 'ลาฉุกเฉิน') stats.emergency++;
    else if (record.type === 'ลาพักร้อน') stats.vacation++;
  });
  
  // อัปเดตตัวเลขหน้ากากการ์ด
  document.getElementById('stat-sick').textContent = stats.sick;
  document.getElementById('stat-personal').textContent = stats.personal;
  document.getElementById('stat-emergency').textContent = stats.emergency;
  document.getElementById('stat-vacation').textContent = stats.vacation;
  
  // 2. แสดงผลประวัติตารางล่าข้อมูล (ล่าสุด 10 รายการ)
  updateHistoryTable();
  
  // 3. วาดกราฟเปรียบเทียบสถิติ (Chart.js)
  drawCharts(stats);
}

function updateHistoryTable() {
  const tableBody = document.getElementById('history-table-body');
  const emptyState = document.getElementById('history-empty-state');
  const tableWrapper = document.getElementById('history-table-wrapper');
  
  if (state.leaves.length === 0) {
    emptyState.style.display = 'block';
    tableWrapper.style.display = 'none';
    return;
  }
  
  emptyState.style.display = 'none';
  tableWrapper.style.display = 'block';
  
  // เรียงวันลาจากใหม่สุดไปเก่าสุด
  const sortedRecords = [...state.leaves].sort((a, b) => new Date(b.date) - new Date(a.date));
  const recentRecords = sortedRecords.slice(0, 10); // เอาเฉพาะ 10 รายการล่าสุด
  
  tableBody.innerHTML = '';
  
  recentRecords.forEach(record => {
    const row = document.createElement('tr');
    
    // ตั้งคลาสชิปสีตามประเภทการลา
    let typeClass = 'sick';
    if (record.type === 'ลากิจ') typeClass = 'personal';
    else if (record.type === 'ลาฉุกเฉิน') typeClass = 'emergency';
    else if (record.type === 'ลาพักร้อน') typeClass = 'vacation';
    
    const syncStatusHtml = record.synced 
      ? `<span class="sync-badge synced"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>ซิงค์แล้ว</span>`
      : `<span class="sync-badge pending"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>รอซิงค์</span>`;
      
    row.innerHTML = `
      <td><strong>${record.name}</strong></td>
      <td>${formatThaiDate(record.date)}</td>
      <td><span class="type-chip ${typeClass}">${record.type}</span></td>
      <td>${record.reason || '-'}</td>
      <td>${syncStatusHtml}</td>
      <td style="text-align: right;">
        <button class="copy-code-btn" onclick="deleteRecord('${record.id}')" style="color: var(--accent-rose);">ลบ</button>
      </td>
    `;
    
    tableBody.appendChild(row);
  });
}

// ลบรายการบันทึก
window.deleteRecord = function(id) {
  if (confirm('คุณต้องการลบรายการวันลานี้ใช่หรือไม่? (ข้อมูลในเครื่องจะถูกลบออก)')) {
    state.leaves = state.leaves.filter(r => r.id !== id);
    saveLeavesToLocalStorage();
    showToast('ลบรายการสำเร็จแล้ว', 'info');
    updateDashboard();
  }
};

// วาดกราฟ Chart.js
function drawCharts(stats) {
  const ctx = document.getElementById('leaveTypeChart');
  if (!ctx) return;
  
  if (state.charts.pie) {
    state.charts.pie.destroy();
  }
  
  // ตรวจสอบว่ามีข้อมูลสำหรับวาดหรือไม่
  const total = stats.sick + stats.personal + stats.emergency + stats.vacation;
  if (total === 0) {
    // วาดกราฟตัวอย่างจางๆ
    state.charts.pie = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['ไม่มีข้อมูล'],
        datasets: [{
          data: [1],
          backgroundColor: ['rgba(255, 255, 255, 0.05)'],
          borderColor: ['rgba(255, 255, 255, 0.1)'],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        }
      }
    });
    return;
  }
  
  // วาดกราฟวงกลมประเภทการลาที่สวยงาม
  state.charts.pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['ลาป่วย 🤒', 'ลากิจ 📁', 'ลาฉุกเฉิน 🚨', 'ลาพักร้อน 🌴'],
      datasets: [{
        data: [stats.sick, stats.personal, stats.emergency, stats.vacation],
        backgroundColor: [
          'rgba(244, 63, 94, 0.7)',
          'rgba(59, 130, 246, 0.7)',
          'rgba(249, 115, 22, 0.7)',
          'rgba(16, 185, 129, 0.7)'
        ],
        borderColor: [
          '#f43f5e',
          '#3b82f6',
          '#f97316',
          '#10b981'
        ],
        borderWidth: 2,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            font: {
              family: "'Inter', sans-serif",
              size: 11
            },
            padding: 15
          }
        }
      },
      cutout: '65%'
    }
  });
}

// --- UTILITIES / TOAST / HELPERS ---
function generateId() {
  return 'lvl_' + Math.random().toString(36).substr(2, 9);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconSvg = '';
  switch(type) {
    case 'success':
      iconSvg = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
      break;
    case 'error':
      iconSvg = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
      break;
    case 'warning':
      iconSvg = '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
      break;
    default:
      iconSvg = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
  }
  
  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-message">${message}</div>
  `;
  
  container.appendChild(toast);
  
  // นำออกหลังจาก 4 วินาที
  setTimeout(() => {
    toast.classList.add('fadeOut');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

// จัดรูปแบบวันที่ไทยให้อ่านง่าย เช่น 21 พฤษภาคม 2026
function formatThaiDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    const day = d.getDate();
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const month = months[d.getMonth()];
    const year = d.getFullYear() + 543; // แปลง ค.ศ. เป็น พ.ศ.
    return `${day} ${month} ${year}`;
  } catch(e) {
    return dateStr;
  }
}

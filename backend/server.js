process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { loginToVTOP, getAuthData } = require('./vtop-auth');
const {
  getCGPA,
  getAttendance,
  getAssignments,
  getMarks,
  getLoginHistory,
  getExamSchedule,
  getTimetable,
  getLeaveHistory,
  getGrades,
  getPaymentHistory,
  getProctorDetails,
  getGradeHistory,
  getCounsellingRank,
  getFacultyInfo,
  getFacultyDetailsByEmpId,
  getAcademicCalendar,
  getLeaveStatus,
  downloadGradeHistory
} = require('./vtop-functions');
const { searchPapers } = require('./papers');
const { searchCodeChefPapers } = require('./codechef-papers');
const { initDB, logUserLogin } = require('./db');


const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const demoUsername = process.env.VTOP_USERNAME;
const demoPassword = process.env.VTOP_PASSWORD;

// --- Helper for Global Key Rotation ---
// Ensure we have keys; if only GEMINI_API_KEY is present, use that.
let keysSource = process.env.GEMINI_KEYS || process.env.GEMINI_API_KEY || "";

const GEMINI_KEYS = keysSource ? keysSource.split(',').map(k => k.trim()).filter(k => k.length > 0) : [];

if (GEMINI_KEYS.length === 0) {
    console.warn("⚠️ No GEMINI_KEYS or GEMINI_API_KEY found in environment variables.");
} else {
    console.log(`✅ Loaded ${GEMINI_KEYS.length} Gemini API keys.`);
}

// Separate rotation indices for each model tier (Round-Robin)
let indexLite = 0;
let indexFlash = 0;

// Blocked keys are now stored as strings: "KEY_VALUE::MODEL_NAME"
const blockedKeys = new Set();
const MODELS = {
    LITE: "gemini-2.5-flash-lite",
    FLASH: "gemini-2.5-flash"
};

function getBestSessionConfig() {
    if (GEMINI_KEYS.length === 0) {
        if (process.env.GEMINI_API_KEY) return { key: process.env.GEMINI_API_KEY, model: MODELS.LITE };
        return null;
    }

    // TIER 1: Try to find a valid key for FLASH LITE
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        let idx = (indexLite + i) % GEMINI_KEYS.length;
        let key = GEMINI_KEYS[idx];
        let blockTag = `${key}::${MODELS.LITE}`;

        if (!blockedKeys.has(blockTag)) {
            indexLite = (idx + 1) % GEMINI_KEYS.length; // Rotate for next user
            return { key: key, model: MODELS.LITE };
        }
    }

    // TIER 2: If all LITE keys are blocked, try FLASH (Standard)
    // Note: Quotas are separate, so a key blocked on Lite might work on Flash
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        let idx = (indexFlash + i) % GEMINI_KEYS.length;
        let key = GEMINI_KEYS[idx];
        let blockTag = `${key}::${MODELS.FLASH}`;

        if (!blockedKeys.has(blockTag)) {
            indexFlash = (idx + 1) % GEMINI_KEYS.length; // Rotate for next user
            return { key: key, model: MODELS.FLASH };
        }
    }

    console.warn("⚠️ ALL API KEYS EXHAUSTED on BOTH tiers.");
    return null; // Total system failure (All keys on all models are dead)
}

function blockKey(key, model, errorMsg = "") {
    if (!key || !model) return;
    
    // Create unique tag for Key + Model combo
    const blockTag = `${key}::${model}`;
    blockedKeys.add(blockTag);

    // Check blockage type
    const isDailyLimit = errorMsg && (
        errorMsg.toLowerCase().includes("day") || 
        errorMsg.toLowerCase().includes("daily") ||
        errorMsg.includes("GenerateRequestsPerDay")
    );
                         
    const duration = isDailyLimit ? 24 * 60 * 60 * 1000 : 60000; 
    const type = isDailyLimit ? "DAILY LIMIT (24h)" : "RPM LIMIT (1m)";

    console.warn(`⛔ Blocked Key on [${model}] due to ${type}.`);
    
    setTimeout(() => {
        blockedKeys.delete(blockTag);
        console.log(`🟢 Key unblocked for [${model}]`);
    }, duration);
}
// --------------------------------------

const sessions = {}; // Store sessions separately
const MAX_HISTORY = 5; // Keep last 5 messages for context

function createSession() {
  const sessionId = require('crypto').randomBytes(16).toString('hex');
  sessions[sessionId] = {
    isLoggedIn: false,
    conversationHistory: [],
    currentCredentials: {},
    cache: {
  cgpa: { data: null, timestamp: 0 },
  attendance: { data: null, timestamp: 0 },
  marks: { data: null, timestamp: 0 },
  assignments: { data: null, timestamp: 0 },
  loginHistory: { data: null, timestamp: 0 },
  examSchedule: { data: null, timestamp: 0 },
  timetable: { data: null, timestamp: 0 },
  leaveHistory: { data: null, timestamp: 0 },
  grades: { data: null, timestamp: 0 },
  paymentHistory: { data: null, timestamp: 0 },
  proctorDetails: { data: null, timestamp: 0 },
  gradeHistory: { data: null, timestamp: 0 },
  counsellingRank: { data: null, timestamp: 0 },
  academicCalendar: { data: null, timestamp: 0 },
  leaveStatus: { data: null, timestamp: 0 }
  }
  };
  return sessionId;
}

function getSession(sessionId) {
  return sessions[sessionId] || null;
}

// Intent recognition - NOW RETURNS ARRAY OF INTENTS
async function recognizeIntent(message, session, retryCount = 0) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  
  const config = getBestSessionConfig();
  if (!config) {
     console.error("❌ All API keys exhausted (Both Tiers). Returning general intent.");
     return ['general'];
  }
  
  const { key, model: modelName } = config;
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: modelName });
  
  const recentHistory = session.conversationHistory.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }]
  }));
  
  const prompt = `
  You are an advanced intent classifier for a VTOP assistant.
  Analyze the user's message and return ALL intents they're asking for.
  
  Available functions:
- getCGPA: CGPA queries, semester reports, overall performance
- getAttendance: Attendance percentage, classes attended, debarment risk
- getMarks: Marks, grades, scores, CAT/FAT marks, best/worst subjects
- getAssignments: Digital assignments, DA deadlines, urgent tasks
- getExamSchedule: Exam schedule, dates, venue
- getLoginHistory: Login history, session records
- getTimetable: Timetable, schedule, class timings, weekly schedule
- getLeaveHistory: Leave history, hostel leaves, leave status
- getGrades: Semester grades, GPA, course grades
- getPaymentHistory: Fee payments, receipts, transactions
- getProctorDetails: Proctor information, faculty advisor
- getLeaveStatus: Current leave status, pending/approved leaves
- getGradeHistory: Complete academic history, grade distribution, curriculum progress
- getCounsellingRank: Hostel counselling rank, slot, timings
- getFacultyInfo: Faculty search, contact details, open hours
- getAcademicCalendar: Academic calendar, holidays, exam dates, instructional days
- downloadGradeHistory: Generate/Download student grade history PDF
- general: Greetings, help, unclear requests,tell user about available functions

IMPORTANT:
- If user asks for multiple things, return ALL relevant intents
- "Semester report" or "complete overview" = getCGPA,getAttendance,getMarks,getAssignments
- "Which subject has lowest/highest X" = getMarks or getAttendance (based on context)
- Subject-specific queries still return the main intent (marks/attendance)
- "Academic history" or "all grades" = getGradeHistory
- "Faculty" or "professor" queries = getFacultyInfo
- "When is CAT1/CAT2/FAT" = getAcademicCalendar (Prefer calendar for general dates as exam schedule might be outdated)
- Return as comma-separated list

Examples:
  * "Show semester report" → getCGPA,getAttendance,getMarks,getAssignments
  * "Which subject am I worst at?" → getMarks
  * "Show attendance and marks" → getAttendance,getMarks
  * "Am I at risk of debarment?" → getAttendance
  * "Which deadline is urgent?" → getAssignments
  * "Show marks for IoT Boards" → getMarks
  * "Show my leave history" → getLeaveHistory
  * "What's my hostel counselling rank?" → getCounsellingRank
  * "Find faculty named Yokesh" → getFacultyInfo
  * "Show complete academic history" → getGradeHistory
  * "Download my grade history" → downloadGradeHistory
  User's message: "${message}"
  
  Respond with ONLY the function names, comma-separated. No explanations.
`;

  try {
    const result = await model.generateContent({
      contents: [
        ...recentHistory,
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ]
    });
    
    const response = result.response.text().trim().toLowerCase();
    
    // Parse comma-separated intents
    const intents = response.split(',').map(i => i.trim()).filter(i => i);
    
    console.log(`[Multi-Intent] Detected: ${intents.join(', ')}`);
    
    return intents.length > 0 ? intents : ['general'];
  } catch (error) {
    if (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
       const isDaily = error.message?.toLowerCase().includes("daily") || error.message?.includes("GenerateRequestsPerDay");
       const type = isDaily ? "DAILY LIMIT" : "RPM LIMIT";
       
       // Only log full error if it's NOT a standard 429 (to reduce spam)
       if (!isDaily) console.warn(`⚠️ ${type} (429) during intent recognition on [${modelName}]. Rotating...`);

       blockKey(key, modelName, error.message); // Block specific Key+Model combo

       if (retryCount < GEMINI_KEYS.length * 2) {
         return recognizeIntent(message, session, retryCount + 1); 
       }
       console.warn("⚠️ ALL API KEYS EXHAUSTED for recognizeIntent - returning general intent.");
    } else if (error.message?.includes('503') || error.message?.includes('overloaded')) {
      console.warn('Model overloaded (503) during intent recognition, rotating key...');
       if (retryCount < GEMINI_KEYS.length) {
         return recognizeIntent(message, session, retryCount + 1); 
       }
    } else {
      console.error('Error in intent recognition:', error.message || error);
    }
    return ['general'];
  }
}

const VTOP_SYSTEM_INSTRUCTION = `
You are a VTOP chatbot assistant for VIT students.

You can help with:
- 📊 View CGPA and semester reports
- 📝 Check marks and identify best/worst performing subjects
- 📅 Monitor attendance and debarment risk
- 📋 Track assignment deadlines
- 📆 View exam schedules (FAT, CAT1, CAT2)
- 🕐 Check class timetable and weekly schedule
- 🏖️ View leave history and approval status
- 🎓 Check semester grades and GPA
- 💳 View payment history and fee receipts
- 👨‍🏫 Get proctor details and contact information
- 📚 View complete academic grade history
- 🎯 Check hostel counselling rank and slot
- 📋 Check current leave status and pending applications
- 🔍 Search for faculty information and contact details
- 🔐 View login history and session records

Answer warmly and guide them on what you can help with.
`;

// Response generation using AI
async function generateResponse(intent, data, originalMessage, session, retryCount = 0) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  
  const config = getBestSessionConfig();
  if (!config) {
     return "I'm having trouble with my API keys right now (All keys exhausted/blocked). Please tell the developer.";
  }
  
  const { key, model: modelName } = config;
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ 
    model: modelName,
    systemInstruction: VTOP_SYSTEM_INSTRUCTION
  });
  
  const recentHistory = session.conversationHistory.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }]
  }));
  
  let prompt = '';
  
  switch (intent) {
    case 'getcgpa':
      prompt = `
        The user asked: "${originalMessage}"
        Their CGPA data is: ${JSON.stringify(data, null, 2)}
        
        Generate a friendly, encouraging response about their CGPA. Keep it conversational and positive.
        Include the CGPA value and maybe a motivational comment.
      `;
      break;
      
    case 'getattendance':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their attendance data: ${JSON.stringify(data, null, 2)}
    
    **IMPORTANT NOTE**: This calculator calculates attendance to 74.01% (which VIT considers as 75%).
    
    Create a markdown table with these columns:
    | Course | Attended/Total | Percentage | 75% Alert | Status |
    
    For the "75% Alert" column, use the 'alertMessage' field from the data.
        
    After the table, add an Analysis section(keep it super short) with:
    - **Overall Summary**: How many courses are safe, in caution zone, or in danger
    - **⚠️ Courses Needing Attention** (below 75%): List them with how many classes needed
    
    Use markdown formatting (bold, emphasis) for important points.
    IMP: If user is asking for particular subject attendance then show only that subject attendance not all subjects.
    and if user is asking for best/worst subject then include that in analysis part only not in table part.
    and if user is asking for only danger/caution/safe subjects then show only those subjects in table part.
    and if user is asking for particular subject like IoT or DS etc then show only that subject attendance not all subjects.
    and if user is asking for classes needed to reach 75% then include that in analysis part only not in table part.
  `;
  break;
      
    case 'getassignments':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their assignments data: ${JSON.stringify(data, null, 2)}
    
    Format assignments as SEPARATE tables for each course:
    
    For each course, create:
    ### Course Name (Course Code)
    | Assignment | Due Date | Status |
    |------------|----------|--------|
    | Assessment - 1 | 22-Sep-2025 | 5 days left |
    | Assessment - 2 | 31-Oct-2025 | Overdue |
    
    Use the 'status' field from the data (already calculated).
    - Shows "X days overdue" if past due
    - Shows "Due today!" if due today
    - Shows "X days left" if upcoming
    
    
    Use emojis and markdown formatting for emphasis on urgent items.
  `;
  break;

    case 'getmarks':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their marks data: ${JSON.stringify(data, null, 2)}
    
    Format marks as SEPARATE tables for each subject/course:
    
    For each course, create:
    ### Course Name (Course Code)
    | Assessment | Scored | Maximum | Weightage | WeightageMax |
    |------------|--------|---------|-----------|------------  |
    | CAT-1      | X      | Y       | Z         | ZM           |
    | CAT-2      | X      | Y       | Z         | ZM           |
    | Total(Bold)| X      | Y       | Z         | ZM           |
    
    After each course table, show:
    - Lost Weightage: ZM - Z
    
    If passingInfo exists, add:
    **🎯 Passing Status:**
    - Type: Theory/Lab/STS
    - Status: ✅ Safe / 🔴 Need X marks in FAT to pass
    
    
    Use markdown formatting and emojis for visual appeal.
    IMP: Sometimes dont ask more than the user asked for example if user is asking for only IoT marks then show only IoT marks not all.
    and if user is asking for best/worst subject then include that in analysis part only not in table part.
    and also if user is asking for particular assessment like CAT1 marks then show only CAT1 marks not CAT2 or total.
    and if user is asking for weightage marks only then show only weightage marks not scored or maximum
    and if user is asking for only theory or lab marks then show only that not both.
    and if user is asking for particular subject like IoT or DS etc then show only that subject marks not all subjects.
    but definetly use markdown even if user is asking for single subject marks
  `;
  break;

    case 'getloginhistory':
      prompt = `
        The user asked: "${originalMessage}"
        Here's their login history data: ${JSON.stringify(data, null, 2)}
        
        Format as a markdown table with columns:
        | Date | Time | IP Address | Status |
        
        Fill in the login history data.
        
        Then add a summary with:
        - Total logins
        - Most recent login
        - Any suspicious activity (if applicable)
        
        Use markdown formatting for clarity.
      `;
      break;

    case 'getexamschedule':
      prompt = `
        The user asked: "${originalMessage}"
        Here's their exam schedule data: ${JSON.stringify(data, null, 2)}
        
        Create separate markdown tables for each exam type (FAT, CAT1, CAT2) with columns:
        | Course Code | Course Title | Date | Time | Venue | Seat No |
        
        Then add a summary section with:
        - Exam dates timeline
        - Reporting times
        - Important reminders
        
        Use markdown formatting (bold headers, emphasis for important dates).
        If user asked for any particular schedule like for FAT then show only for Fat not cat2 or cat1.
      `;
      break;

      case 'gettimetable':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their timetable data: ${JSON.stringify(data, null, 2)}
    
    Format the timetable in a clean, day-wise view:(Also if user is asking for a particular day then show only for that day not all)
    
    ## 📅 Weekly Schedule
    
    For each day (Monday to Friday), create:
    ### Monday
    | Time | Course | Venue | Slot |
    |------|--------|-------|---------|
    | 08:00 - 09:00 AM | CSE1001 - Problem Solving | AB1-G03 | A1 |
    | ... | ... | ... | ... |
    
    
    
    Use emojis to make it visually appealing:
    - 🕐 for time-related info
    - 📚 for courses
    - 👨‍🏫 for faculty
    - 🏢 for venues
    
    Use markdown formatting for clarity.
    Also if there is lab sessions include them appropriately like slot L35+L36 is one column not separately
  `;
  break;

    case 'getleavehistory':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their leave history data: ${JSON.stringify(data, null, 2)}
    
    Format as a markdown table with columns:
    | Place | Reason | Type | From → To | Status |
    
    Use emojis for status:
    - ✅ for APPROVED (not cancelled)
    - ❌ for CANCELLED
    - ⏳ for PENDING
    
    After the table, add a summary with:
    - Total leaves taken
    - Approved vs cancelled leaves
    - Any patterns (frequent leaves, etc.)
    
    Use markdown formatting for clarity.
  `;
  break;

case 'getgrades':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their semester grades data: ${JSON.stringify(data, null, 2)}
    
    Create a markdown table with columns:
    | Course Code | Course Title | Credits | Total | Grade |
    
    Use grade emojis:
    - 🌟 for S grade
    - ✅ for A grade
    - 👍 for B grade
    - 📘 for C grade
    - 📙 for D grade
    - ⚠️ for E grade
    - ❌ for F grade
    
    After the table, show:
    - GPA for this semester
    - Total courses
    - Grade distribution summary
    
    Use markdown formatting (bold headers, emphasis).
  `;
  break;

case 'getpaymenthistory':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their payment history: ${JSON.stringify(data, null, 2)}
    
    Format as a markdown table with columns:
    | Invoice No | Receipt No | Date | Amount | Campus |
    
    After the table, add:
    - Total amount paid
    - Total transactions
    - Latest payment date
    
    Use markdown formatting and include ₹ symbol for amounts.
  `;
  break;

case 'getproctordetails':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their proctor details: ${JSON.stringify(data, null, 2)}
    
    Format the proctor information in a clean way:
    - Name
    - Designation
    - Department
    - School
    - Email
    - Cabin number
    
    Use emojis like 👨‍🏫 for name, 📧 for email, 📍 for cabin.
    Use markdown formatting for readability.
  `;
  break;

case 'getgradehistory':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their complete grade history: ${JSON.stringify(data, null, 2)}
    
    Create a comprehensive academic history report:
    
    1. **Grade Distribution** (with emojis):
       Show count for each grade (S, A, B, C, D, E, F, P)
    
    2. **Overall Performance**:
       - CGPA
       - Total courses completed
       - Total credits registered vs earned
    
    3. **Curriculum Progress**:
       Show progress for each requirement type (Foundation Core, Discipline Core, etc.)
       Use ✅ for completed, ⏳ for in-progress
    
    4. **Recent Courses** (last 5-10 courses):
       Table with: Course | Grade | Credits | Exam Month
    
    5. **PDF Download**:
       At the end, add a friendly line like "📄 Want the complete official record? [Download Grade History PDF](/api/downloads/grade-history?sessionId=${session.id})"
    
    Use markdown formatting extensively.
  `;
  break;

case 'getcounsellingrank':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their counselling rank details: ${JSON.stringify(data, null, 2)}
    
    Format the counselling information clearly:
    - 🎯 Counselling Rank
    - 👥 Group
    - 🎫 Slot
    - ⏰ Report Time
    - 📍 Venue
    - 📅 Counseling Date
    
    Use emojis and markdown formatting for emphasis.
  `;
  break;

case 'getfacultyinfo':
  prompt = `
    The user asked: "${originalMessage}"
    Here's the faculty information: ${JSON.stringify(data, null, 2)}
    
    HANDLE THESE SCENARIOS:
    
    1. If there's an ERROR (data.error exists):
       - Show the error message from data.error
       - Give helpful suggestions (check spelling, use at least 3 characters, etc.)
    
    2. If MULTIPLE FACULTIES found (data.requiresSelection === true):
       - Show data.message
       - List all faculties with:
         * Name
         * Designation
         * School
       - Ask user to be more specific or choose one
    
    3. If SINGLE FACULTY details provided:
       - Format clearly with:
         * 👤 Name: [name]
         * 🏢 Designation: [designation]
         * 🏛️ Department: [details['Name of Department']]
         * 🎓 School: [details['School / Centre Name'] or school]
         * 📧 Email: [details['E-Mail Id']]
         * 📍 Cabin: [details['Cabin Number']]
         * ⏰ Open Hours (if openHours array has data):
           List each day and timing
    
    Use markdown formatting for readability and emojis for visual appeal.
  `;
  break;
  case 'getacademiccalendar':
  const currentDate = new Date().toDateString();
  prompt = `
    The user asked: "${originalMessage}"
    CURRENT REAL DATE: ${currentDate}
    Here's the academic calendar data: ${JSON.stringify(data, null, 2)}
    
    IMPORTANT INSTRUCTIONS:
    1. **Context Awareness**: Use CURRENT DATE (${currentDate}) to answer relative questions (e.g., "next working saturday", "upcoming holidays", "how many days left").
    2. **Smart Filtering**: 
       - If user asks for specific events (e.g., "When is Pongal?", "Holidays in Jan"), show ONLY those specific dates. DO NOT show the whole calendar.
       - If user asks for "next working Saturday", find the next 'Instructional Day' falling on a Saturday AFTER ${currentDate}.
    3. **Full Calendar**: Only show the full month-wise view if explicitly asked (e.g., "show academic calendar", "full schedule").

    Format for Full Calendar (if requested):
    For each month (July to November):
    ### 📅 MONTH YEAR
    - Show events with emojis: 🎯 Start, 📚 Instructional, 🏖️ Holiday, 📝 Exam
    
    Format for Specific/Relative Queries:
    - 📅 **Event Name**: Date - Note (if any)
    
    Use markdown formatting.
  `;
  break;
  case 'getleavestatus':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their current leave status: ${JSON.stringify(data, null, 2)}
    
    Format as a markdown table with columns:
    | Place | Reason | Type | From → To | Status |
    
    Use emojis for status:
    - ✅ for APPROVED
    - ❌ for REJECTED/CANCELLED
    - ⏳ for PENDING
    
    After the table, add a summary with:
    - Active/pending leaves
    - Recently approved leaves
    - Any action needed
    
    Use markdown formatting for clarity.
  `;
  break;
  case 'downloadgradehistory':
  prompt = `
    The user asked: "${originalMessage}"
    
    Respond by providing a direct link to download their Grade History PDF.
    
    Use this EXACT Markdown link format:
    [📄 Download Grade History PDF](/api/downloads/grade-history?sessionId=${session.id})
    
    Tell them the file will contain their complete academic performance record.
  `;
  break;
    default:
      prompt = `
      The user asked: "${originalMessage}"
      
      Based on our conversation, answer their question naturally.
      If they're asking comparative questions like "which subject is worst" or "what needs attention",
      acknowledge that you can fetch that data for them and ask if they'd like you to show it.
    `;
  break;
  }

  try {
    const result = await model.generateContent({
      contents: [
        ...recentHistory,
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ]
    });
    return result.response.text().trim();
  } catch (error) {
    if (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
       const isDaily = error.message?.toLowerCase().includes("daily") || error.message?.includes("GenerateRequestsPerDay");
       const type = isDaily ? "DAILY LIMIT" : "RPM LIMIT";

       if (!isDaily) console.warn(`⚠️ ${type} (429) during response generation on [${modelName}]. Rotating...`);

       blockKey(key, modelName, error.message); 
       if (retryCount < GEMINI_KEYS.length * 2) {
         return generateResponse(intent, data, originalMessage, session, retryCount + 1); 
       }
       return "My daily request limit has been reached (429). Please try again later.";
    } else if (error.message?.includes('503') || error.message?.includes('overloaded')) {
       console.warn('Model overloaded (503) during response generation, rotating key...');
       if (retryCount < GEMINI_KEYS.length) {
         return generateResponse(intent, data, originalMessage, session, retryCount + 1); 
       }
      return "The AI model is currently overloaded with too many requests. Please try again in a moment.";
    } else {
      console.error('Error generating response:', error.message || error);
    }
    return "I'm having trouble generating a response right now. Please try again.";
  }
}
// Generate response with multiple data sources
async function generateResponseMulti(intents, allData, originalMessage, session, retryCount = 0) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  
  const config = getBestSessionConfig();
  if (!config) {
     return "I'm having trouble with my API keys right now (All keys exhausted/blocked). Please tell the developer.";
  }
  
  const { key, model: modelName } = config;
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ 
    model: modelName,
    systemInstruction: VTOP_SYSTEM_INSTRUCTION
  });
  
  const recentHistory = session.conversationHistory.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }]
  }));
  
  // Build comprehensive data context and prompts based on intents
  let dataContext = '';
  let promptSections = [];
  
  // CGPA
  if (allData.cgpa && intents.includes('getcgpa')) {
    dataContext += `\nCGPA Data: ${JSON.stringify(allData.cgpa, null, 2)}`;
    promptSections.push(`For CGPA: Generate a friendly, encouraging response about their CGPA. Keep it conversational and positive. Include the CGPA value and maybe a motivational comment.`);
  }
  
  // Attendance
  if (allData.attendance && intents.includes('getattendance')) {
  dataContext += `\nAttendance Data: ${JSON.stringify(allData.attendance, null, 2)}`;
  promptSections.push(`For Attendance: Create a table with columns: Course | Attended/Total | Percentage | 75% Alert | Status. Use 'alertMessage' for alerts and 'alertStatus' for status emojis (🔴 danger, ⚠️ caution, ✅ safe). Add analysis of courses needing attention with specific class counts needed.`);
}
  
  // Assignments
if (allData.assignments && intents.includes('getassignments')) {
  dataContext += `\nAssignments Data: ${JSON.stringify(allData.assignments, null, 2)}`;
  promptSections.push(`For Assignments: Create SEPARATE tables for each course. Format: ### Course Name (Code), then table with columns: | Assignment | Due Date | Days Left |. Show "X days overdue" if past, "Due today!" if today, "X days left" if upcoming. Then summary with overdue and urgent deadlines (3-7 days).`);
}
  
  // Marks
if (allData.marks && intents.includes('getmarks')) {
  dataContext += `\nMarks Data: ${JSON.stringify(allData.marks, null, 2)}`;
  promptSections.push(`For Marks: Create SEPARATE tables for each subject. Format: ### Course Name (Code), then table with columns: | Assessment | Scored | Maximum | Weightage | Weightage% |. Add course total after each table. Then overall analysis in very short`);
}
  
  // Login History
  if (allData.loginHistory && intents.includes('getloginhistory')) {
    dataContext += `\nLogin History: ${JSON.stringify(allData.loginHistory, null, 2)}`;
    promptSections.push(`For Login History: Format as a markdown table with columns: | Date | Time | IP Address | Status |. Fill in the login history data. Then add a summary with: Total logins, Most recent login, Any suspicious activity (if applicable). Use markdown formatting for clarity.`);
  }
  
  // Exam Schedule
if (allData.examSchedule && intents.includes('getexamschedule')) {
    dataContext += `\nExam Schedule: ${JSON.stringify(allData.examSchedule, null, 2)}`;
    promptSections.push(`For Exam Schedule: Create separate markdown tables for each exam type (FAT, CAT1, CAT2) with columns: | Course Code | Course Title | Date | Time | Venue | Seat No |. Then add a summary section with: Exam dates timeline, Reporting times, Important reminders. Use markdown formatting (bold headers, emphasis for important dates).`);
  }

  // Timetable
if (allData.timetable && intents.includes('gettimetable')) {
  dataContext += `\nTimetable Data: ${JSON.stringify(allData.timetable, null, 2)}`;
  promptSections.push(`For Timetable: Create day-wise tables (Monday-Friday) with columns: Time | Course | Venue | Faculty. Add a course summary with total classes per week and observations.`);
}

// Leave History
if (allData.leaveHistory && intents.includes('getleavehistory')) {
  dataContext += `\nLeave History: ${JSON.stringify(allData.leaveHistory, null, 2)}`;
  promptSections.push(`For Leave History: Create a table with columns: | Place | Reason | Type | From → To | Status |. Use ✅ for approved, ❌ for cancelled, ⏳ for pending. Add summary with total leaves and approval rate.`);
}

// Leave Status
if (allData.leaveStatus && intents.includes('getleavestatus')) {
  dataContext += `\nLeave Status: ${JSON.stringify(allData.leaveStatus, null, 2)}`;
  promptSections.push(`For Leave Status: Create table with current leave applications showing place, reason, type, dates, and status with appropriate emojis.`);
}

// Grades
if (allData.grades && intents.includes('getgrades')) {
  dataContext += `\nGrades Data: ${JSON.stringify(allData.grades, null, 2)}`;
  promptSections.push(`For Grades: Create a table with columns: | Course Code | Course Title | Credits | Total | Grade |. Use grade emojis (🌟 S, ✅ A, 👍 B, etc.). Show GPA and grade distribution summary.`);
}

// Payment History
if (allData.paymentHistory && intents.includes('getpaymenthistory')) {
  dataContext += `\nPayment History: ${JSON.stringify(allData.paymentHistory, null, 2)}`;
  promptSections.push(`For Payment History: Create a table with columns: | Invoice No | Receipt No | Date | Amount | Campus |. Show total amount paid and transaction count.`);
}

// Proctor Details
if (allData.proctorDetails && intents.includes('getproctordetails')) {
  dataContext += `\nProctor Details: ${JSON.stringify(allData.proctorDetails, null, 2)}`;
  promptSections.push(`For Proctor Details: Format with emojis (👨‍🏫 name, 📧 email, 📍 cabin). Include name, designation, department, school, email, cabin.`);
}

// Grade History
if (allData.gradeHistory && intents.includes('getgradehistory')) {
  dataContext += `\nGrade History: ${JSON.stringify(allData.gradeHistory, null, 2)}`;
  promptSections.push(`For Grade History: Show comprehensive academic report with grade distribution, CGPA, credits, curriculum progress, and recent courses table.`);
}

// Counselling Rank
if (allData.counsellingRank && intents.includes('getcounsellingrank')) {
  dataContext += `\nCounselling Rank: ${JSON.stringify(allData.counsellingRank, null, 2)}`;
  promptSections.push(`For Counselling Rank: Format with emojis showing rank, group, slot, report time, venue, and counseling date.`);
}

// Faculty Info
if (allData.facultyInfo && intents.includes('getfacultyinfo')) {
  dataContext += `\nFaculty Info: ${JSON.stringify(allData.facultyInfo, null, 2)}`;
  promptSections.push(`For Faculty Info: If multiple results, list all. If single result, show details with name, designation, department, school, email, cabin, open hours in structured way.`);
}

// Academic Calendar
if (allData.academicCalendar && intents.includes('getacademiccalendar')) {
  const currentDate = new Date().toDateString();
  dataContext += `\nAcademic Calendar: ${JSON.stringify(allData.academicCalendar, null, 2)}\nCURRENT DATE: ${currentDate}`;
  promptSections.push(`For Academic Calendar: Use CURRENT DATE (${currentDate}) for relative queries ("next Saturday"). Only show specific events if asked (e.g., "Pongal only"). If full calendar requested, show month-wise summary.`);
}

  // Build the final prompt
  let prompt = `The user asked: "${originalMessage}"

You have access to multiple data sources:
${dataContext}

FORMATTING INSTRUCTIONS:
${promptSections.join('\n')}

IMPORTANT:
- Present ALL the data the user requested
- Organize it clearly with headers for each section
- Keep it concise but comprehensive
- Add a brief summary at the start if multiple data types
- Use proper formatting for readability`;

  try {
    const result = await model.generateContent({
      contents: [
        ...recentHistory,
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ]
    });
    return result.response.text().trim();
  } catch (error) {
    if (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
       const isDaily = error.message?.toLowerCase().includes("daily") || error.message?.includes("GenerateRequestsPerDay");
       const type = isDaily ? "DAILY LIMIT" : "RPM LIMIT";

       if (!isDaily) console.warn(`⚠️ ${type} (429) during multi-response generation on [${modelName}]. Rotating...`);

       blockKey(key, modelName, error.message); 
       if (retryCount < GEMINI_KEYS.length * 2) {
         return generateResponseMulti(intents, allData, originalMessage, session, retryCount + 1); 
       }
       return "My daily request limit has been reached (429). Please try again later.";
    } else if (error.message?.includes('503') || error.message?.includes('overloaded')) {
       console.warn('Model overloaded (503) during multi-response generation, rotating key...');
       if (retryCount < GEMINI_KEYS.length) {
         return generateResponseMulti(intents, allData, originalMessage, session, retryCount + 1); 
       }
      return "The AI model is currently overloaded with too many requests. Please try again in a moment.";
    } else {
      console.error('Error generating response:', error.message || error);
    }
    return "I'm having trouble generating a response right now. Please try again.";
  }
}

// ===== LOGIN ENDPOINT =====
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, useDemo, sessionId, campus = 'vellore' } = req.body;
    
    let session = getSession(sessionId);
    
    // Always clear old session data on new login attempt
    // This fixes the issue where refreshing page but using same sessionId (from localStorage)
    // would keep old cache/credentials if the server wasn't restarted
    if (session) {
      delete sessions[sessionId];
    }
    
    // Create fresh session
    sessions[sessionId] = {
      isLoggedIn: false,
      conversationHistory: [],
      currentCredentials: {},
      cache: {
        cgpa: { data: null, timestamp: 0 },
        attendance: { data: null, timestamp: 0 },
        marks: { data: null, timestamp: 0 },
        assignments: { data: null, timestamp: 0 },
        loginHistory: { data: null, timestamp: 0 },
        examSchedule: { data: null, timestamp: 0 },
        timetable: { data: null, timestamp: 0 },
        leaveHistory: { data: null, timestamp: 0 },
        grades: { data: null, timestamp: 0 },
        paymentHistory: { data: null, timestamp: 0 },
        proctorDetails: { data: null, timestamp: 0 },
        gradeHistory: { data: null, timestamp: 0 },
        counsellingRank: { data: null, timestamp: 0 },
        academicCalendar: { data: null, timestamp: 0 },
        leaveStatus: { data: null, timestamp: 0 }
      }
    };
    session = sessions[sessionId];
    
    let loginUsername, loginPassword;
    
    if (useDemo) {
      loginUsername = demoUsername;
      loginPassword = demoPassword;
      session.currentCredentials = {
        username: loginUsername,
        password: loginPassword,
        isDemo: true,
        campus: 'vellore'
      };
    } else {
      if (!username || !password) {
        return res.status(400).json({ 
          success: false, 
          error: 'Username and password required' 
        });
      }
      loginUsername = username;
      loginPassword = password;
      session.currentCredentials = {
        username: loginUsername,
        password: loginPassword,
        isDemo: false,
        campus: campus
      };
    }

    // Pass sessionId and campus to loginToVTOP
    const result = await loginToVTOP(loginUsername, loginPassword, sessionId, campus);
    
    // Login result is now an object { success: boolean, error?: string }
    if (result && result.success) {
      session.isLoggedIn = true;

      // Log to Database (Async, don't wait for response)
      getAuthData(sessionId).then(authData => {
        if (authData && authData.authorizedID) {
          logUserLogin(authData.authorizedID, sessionId, campus);
        }
      });

      res.json({ 
        success: true, 
        isDemo: session.currentCredentials.isDemo,
        message: 'Login successful',
        sessionId: sessionId
      });
    } else {
      res.json({ 
        success: false, 
        message: result.error || 'Login failed. Please check your credentials.'
      });
    }
  } catch (error) {
    console.error('Login error:', error.message || error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// ===== CHAT ENDPOINT WITH STREAMING =====
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const session = getSession(sessionId);
    
    // Inject ID for internal use
    if (session) session.id = sessionId;

    if (!session || !session.isLoggedIn) {
      return res.json({ 
        response: "I'm not connected to VTOP right now. Please refresh the page to reconnect.",
        data: null 
      });
    }

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    session.conversationHistory.push({ role: 'user', content: message });
    if (session.conversationHistory.length > MAX_HISTORY) {
      session.conversationHistory.shift();
    }

    // Get MULTIPLE intents (array)
    const intents = await recognizeIntent(message, session);
    console.log(`[${sessionId}] Recognized intents:`, intents.join(', '));

    let allData = {};

    // Check if we need to fetch multiple data sources
    const needsMultipleData = intents.length > 1 && !intents.includes('general');

    if (needsMultipleData) {
      // PARALLEL EXECUTION of multiple functions
      const authData = await getAuthData(sessionId);
      
      const promises = intents.map(async (intent) => {
        try {
          switch (intent) {
            case 'getcgpa':
              allData.cgpa = await getCGPA(authData, session, sessionId);
              break;
            case 'getattendance':
              allData.attendance = await getAttendance(authData, session, sessionId);
              break;
            case 'getmarks':
              allData.marks = await getMarks(authData, session, sessionId);
              break;
            case 'getassignments':
              allData.assignments = await getAssignments(authData, session, sessionId);
              break;
            case 'getloginhistory':
              allData.loginHistory = await getLoginHistory(authData, session, sessionId);
              break;
            case 'getexamschedule':
              allData.examSchedule = await getExamSchedule(authData, session, sessionId);
              break;
            case 'gettimetable':
  allData.timetable = await getTimetable(authData, session, sessionId);
  break;
            case 'getleavehistory':
  allData.leaveHistory = await getLeaveHistory(authData, session, sessionId);
  break;
  case 'getleavestatus':
  allData.leaveStatus = await getLeaveStatus(authData, session, sessionId);
  break;
case 'getgrades':
  allData.grades = await getGrades(authData, session, sessionId);
  break;
case 'getpaymenthistory':
  allData.paymentHistory = await getPaymentHistory(authData, session, sessionId);
  break;
case 'getproctordetails':
  allData.proctorDetails = await getProctorDetails(authData, session, sessionId);
  break;
case 'getgradehistory':
  allData.gradeHistory = await getGradeHistory(authData, session, sessionId);
  break;
case 'getcounsellingrank':
  allData.counsellingRank = await getCounsellingRank(authData, session, sessionId);
  break;
case 'getfacultyinfo':
  // Faculty info requires facultyName parameter - handle separately
  console.log(`[${sessionId}] Faculty info requires name parameter`);
  break;
case 'getacademiccalendar':
  allData.academicCalendar = await getAcademicCalendar(authData, session, sessionId);
  break;
          }
        } catch (error) {
          console.error(`[${sessionId}] Error fetching ${intent}:`, error.message);
        }
      });

      // Wait for all data to be fetched in parallel
      await Promise.all(promises);
      
    } else {
      // Single intent - fetch data
      const intent = intents[0];
      const authData = await getAuthData(sessionId);
      
      try {
        switch (intent) {
          case 'getcgpa':
            allData.cgpa = await getCGPA(authData, session, sessionId);
            break;
          case 'getattendance':
            allData.attendance = await getAttendance(authData, session, sessionId);
            break;
          case 'getleavestatus':
            allData.leaveStatus = await getLeaveStatus(authData, session, sessionId);
            break;
          case 'getassignments':
            allData.assignments = await getAssignments(authData, session, sessionId);
            break;
          case 'getmarks':
            allData.marks = await getMarks(authData, session, sessionId);
            break;
          case 'getloginhistory':
            allData.loginHistory = await getLoginHistory(authData, session, sessionId);
            break;
          case 'getexamschedule':
            allData.examSchedule = await getExamSchedule(authData, session, sessionId);
            break;
          case 'gettimetable':
            allData.timetable = await getTimetable(authData, session, sessionId);
            break;
          case 'getleavehistory':
            allData.leaveHistory = await getLeaveHistory(authData, session, sessionId);
            break;
          case 'getgrades':
            allData.grades = await getGrades(authData, session, sessionId);
            break;
          case 'getpaymenthistory':
            allData.paymentHistory = await getPaymentHistory(authData, session, sessionId);
            break;
          case 'getproctordetails':
            allData.proctorDetails = await getProctorDetails(authData, session, sessionId);
            break;
          case 'getgradehistory':
            allData.gradeHistory = await getGradeHistory(authData, session, sessionId);
            break;
          case 'getcounsellingrank':
            allData.counsellingRank = await getCounsellingRank(authData, session, sessionId);
            break;
          case 'getfacultyinfo':
            let facultyName = message;
            const phrasesToRemove = [
              /^show\s+(me\s+)?/gi, /^find\s+(me\s+)?/gi, /^search\s+(for\s+)?/gi,
              /^get\s+(me\s+)?/gi, /^fetch\s+(me\s+)?/gi, /^tell\s+me\s+about\s+/gi,
              /^who\s+is\s+/gi, /^give\s+me\s+/gi, /^i\s+want\s+/gi,
              /^can\s+you\s+(show|find|get|tell)\s+(me\s+)?/gi
            ];
            phrasesToRemove.forEach(pattern => { facultyName = facultyName.replace(pattern, ''); });
            const keywordsToRemove = [
              /\bfaculty\b/gi, /\bprofessor\b/gi, /\bteacher\b/gi, /\bsir\b/gi,
              /\bmadam\b/gi, /\bma'am\b/gi, /\bmam\b/gi, /\binfo(rmation)?\b/gi,
              /\bdetails?\b/gi, /\babout\b/gi, /\bfor\b/gi, /\bof\b/gi, /\bnamed\b/gi
            ];
            keywordsToRemove.forEach(pattern => { facultyName = facultyName.replace(pattern, ''); });
            facultyName = facultyName.replace(/\?|!|\./g, '').replace(/\s+/g, ' ').trim();
            
            if (!facultyName || facultyName.length < 3) {
              res.write("Please provide the faculty member's name (at least 3 characters). For example: 'Show info for Yokesh' or 'Find faculty Rajesh Kumar'");
              res.end();
              return;
            }
            allData.facultyInfo = await getFacultyInfo(authData, session, sessionId, facultyName);
            break;
          case 'getacademiccalendar':
            allData.academicCalendar = await getAcademicCalendar(authData, session, sessionId);
            break;
        }
      } catch (error) {
        console.error(`[${sessionId}] Error fetching data:`, error.message);
      }
    }

    // Send the DATA packet first
    res.write(JSON.stringify({ type: 'DATA', payload: allData }) + '\n\n');

    // Now generate response using STREAMING
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const config = getBestSessionConfig();
    
    if (!config) {
      res.write("I'm having trouble with my API keys right now (All keys exhausted/blocked). Please tell the developer.");
      res.end();
      return;
    }
    
    const genAI = new GoogleGenerativeAI(config.key);
    const model = genAI.getGenerativeModel({ 
      model: config.model,
      systemInstruction: VTOP_SYSTEM_INSTRUCTION
    });
    
    const recentHistory = session.conversationHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));
    
    // Build prompt based on intents and data
    let prompt = '';
    if (needsMultipleData) {
      let dataContext = '';
      let promptSections = [];
      
      if (allData.cgpa && intents.includes('getcgpa')) {
        dataContext += `\nCGPA Data: ${JSON.stringify(allData.cgpa, null, 2)}`;
        promptSections.push(`For CGPA: Generate a friendly, encouraging response about their CGPA. Keep it conversational and positive. Include the CGPA value and maybe a motivational comment.`);
      }
      if (allData.attendance && intents.includes('getattendance')) {
        dataContext += `\nAttendance Data: ${JSON.stringify(allData.attendance, null, 2)}`;
        promptSections.push(`For Attendance: Create a table with columns: Course | Attended/Total | Percentage | 75% Alert | Status. Use 'alertMessage' for alerts and 'alertStatus' for status emojis (🔴 danger, ⚠️ caution, ✅ safe). Add analysis of courses needing attention with specific class counts needed.`);
      }
      if (allData.assignments && intents.includes('getassignments')) {
        dataContext += `\nAssignments Data: ${JSON.stringify(allData.assignments, null, 2)}`;
        promptSections.push(`For Assignments: Create SEPARATE tables for each course. Format: ### Course Name (Code), then table with columns: | Assignment | Due Date | Days Left |. Show "X days overdue" if past, "Due today!" if today, "X days left" if upcoming. Then summary with overdue and urgent deadlines (3-7 days).`);
      }
      if (allData.marks && intents.includes('getmarks')) {
        dataContext += `\nMarks Data: ${JSON.stringify(allData.marks, null, 2)}`;
        promptSections.push(`For Marks: Create SEPARATE tables for each subject. Format: ### Course Name (Code), then table with columns: | Assessment | Scored | Maximum | Weightage | Weightage% |. Add course total after each table. Then overall analysis in very short`);
      }
      if (allData.loginHistory && intents.includes('getloginhistory')) {
        dataContext += `\nLogin History: ${JSON.stringify(allData.loginHistory, null, 2)}`;
        promptSections.push(`For Login History: Format as a markdown table with columns: | Date | Time | IP Address | Status |. Then add a summary.`);
      }
      if (allData.examSchedule && intents.includes('getexamschedule')) {
        dataContext += `\nExam Schedule: ${JSON.stringify(allData.examSchedule, null, 2)}`;
        promptSections.push(`For Exam Schedule: Create separate tables for each exam type (FAT, CAT1, CAT2) with columns: | Course Code | Course Title | Date | Time | Venue | Seat No |.`);
      }
      if (allData.timetable && intents.includes('gettimetable')) {
        dataContext += `\nTimetable Data: ${JSON.stringify(allData.timetable, null, 2)}`;
        promptSections.push(`For Timetable: Create day-wise tables (Monday-Friday) with columns: Time | Course | Venue | Faculty.`);
      }
      if (allData.leaveHistory && intents.includes('getleavehistory')) {
        dataContext += `\nLeave History: ${JSON.stringify(allData.leaveHistory, null, 2)}`;
        promptSections.push(`For Leave History: Create a table with columns: | Place | Reason | Type | From → To | Status |. Use ✅ for approved, ❌ for cancelled, ⏳ for pending.`);
      }
      if (allData.leaveStatus && intents.includes('getleavestatus')) {
        dataContext += `\nLeave Status: ${JSON.stringify(allData.leaveStatus, null, 2)}`;
        promptSections.push(`For Leave Status: Create table with current leave applications.`);
      }
      if (allData.grades && intents.includes('getgrades')) {
        dataContext += `\nGrades Data: ${JSON.stringify(allData.grades, null, 2)}`;
        promptSections.push(`For Grades: Create a table with columns: | Course Code | Course Title | Credits | Total | Grade |. Use grade emojis.`);
      }
      if (allData.paymentHistory && intents.includes('getpaymenthistory')) {
        dataContext += `\nPayment History: ${JSON.stringify(allData.paymentHistory, null, 2)}`;
        promptSections.push(`For Payment History: Create a table with columns: | Invoice No | Receipt No | Date | Amount | Campus |.`);
      }
      if (allData.proctorDetails && intents.includes('getproctordetails')) {
        dataContext += `\nProctor Details: ${JSON.stringify(allData.proctorDetails, null, 2)}`;
        promptSections.push(`For Proctor Details: Format with emojis (👨‍🏫 name, 📧 email, 📍 cabin).`);
      }
      if (allData.gradeHistory && intents.includes('getgradehistory')) {
        dataContext += `\nGrade History: ${JSON.stringify(allData.gradeHistory, null, 2)}`;
        promptSections.push(`For Grade History: Show comprehensive academic report with grade distribution, CGPA, credits, curriculum progress, and recent courses table.`);
      }
      if (allData.counsellingRank && intents.includes('getcounsellingrank')) {
        dataContext += `\nCounselling Rank: ${JSON.stringify(allData.counsellingRank, null, 2)}`;
        promptSections.push(`For Counselling Rank: Format with emojis showing rank, group, slot, report time, venue, and counseling date.`);
      }
      if (allData.facultyInfo && intents.includes('getfacultyinfo')) {
        dataContext += `\nFaculty Info: ${JSON.stringify(allData.facultyInfo, null, 2)}`;
        promptSections.push(`For Faculty Info: If multiple results, list all. If single result, show details with name, designation, department, school, email, cabin, open hours.`);
      }
      if (allData.academicCalendar && intents.includes('getacademiccalendar')) {
        const currentDate = new Date().toDateString();
        dataContext += `\nAcademic Calendar: ${JSON.stringify(allData.academicCalendar, null, 2)}\nCURRENT DATE: ${currentDate}`;
        promptSections.push(`For Academic Calendar: Use CURRENT DATE (${currentDate}) for relative queries. Only show specific events if asked. If full calendar requested, show month-wise summary.`);
      }

      prompt = `The user asked: "${message}"\n\nYou have access to multiple data sources:\n${dataContext}\n\nFORMATTING INSTRUCTIONS:\n${promptSections.join('\n')}\n\nIMPORTANT:\n- Present ALL the data the user requested\n- Organize it clearly with headers for each section\n- Keep it concise but comprehensive\n- Add a brief summary at the start if multiple data types\n- Use proper formatting for readability`;
    } else {
      // Single intent prompt
      const intent = intents[0];
      const data = Object.values(allData)[0];
      
      switch (intent) {
        case 'getcgpa':
          prompt = `The user asked: "${message}"\nTheir CGPA data is: ${JSON.stringify(data, null, 2)}\n\nGenerate a friendly, encouraging response about their CGPA. Keep it conversational and positive. Include the CGPA value and maybe a motivational comment.`;
          break;
        case 'getattendance':
          prompt = `The user asked: "${message}"\nHere's their attendance data: ${JSON.stringify(data, null, 2)}\n\n**IMPORTANT NOTE**: This calculator calculates attendance to 74.01% (which VIT considers as 75%).\n\nCreate a markdown table with these columns:\n| Course | Attended/Total | Percentage | 75% Alert | Status |\n\nFor the "75% Alert" column, use the 'alertMessage' field from the data. After the table, add an Analysis section(keep it super short) with:\n- **Overall Summary**: How many courses are safe, in caution zone, or in danger\n- **⚠️ Courses Needing Attention** (below 75%): List them with how many classes needed`;
          break;
        case 'getassignments':
          prompt = `The user asked: "${message}"\nHere's their assignments data: ${JSON.stringify(data, null, 2)}\n\nFormat assignments as SEPARATE tables for each course:\n\nFor each course, create:\n### Course Name (Course Code)\n| Assignment | Due Date | Status |\n\nUse the 'status' field from the data (already calculated). Use emojis and markdown formatting for emphasis on urgent items.`;
          break;
        case 'getmarks':
          prompt = `The user asked: "${message}"\nHere's their marks data: ${JSON.stringify(data, null, 2)}\n\nFormat marks as SEPARATE tables for each subject/course:\n\nFor each course, create:\n### Course Name (Course Code)\n| Assessment | Scored | Maximum | Weightage | WeightageMax |\n\nAfter each course table, show: Lost Weightage: ZM - Z\n\nIf passingInfo exists, add:\n**🎯 Passing Status:**\n- Type: Theory/Lab/STS\n- Status: ✅ Safe / 🔴 Need X marks in FAT to pass`;
          break;
        case 'getloginhistory':
          prompt = `The user asked: "${message}"\nHere's their login history data: ${JSON.stringify(data, null, 2)}\n\nFormat as a markdown table with columns:\n| Date | Time | IP Address | Status |`;
          break;
        case 'getexamschedule':
          prompt = `The user asked: "${message}"\nHere's their exam schedule data: ${JSON.stringify(data, null, 2)}\n\nCreate separate markdown tables for each exam type (FAT, CAT1, CAT2) with columns:\n| Course Code | Course Title | Date | Time | Venue | Seat No |`;
          break;
        case 'gettimetable':
          prompt = `The user asked: "${message}"\nHere's their timetable data: ${JSON.stringify(data, null, 2)}\n\nFormat the timetable in a clean, day-wise view. For each day (Monday to Friday), create:\n### Monday\n| Time | Course | Venue | Slot |`;
          break;
        case 'getleavehistory':
          prompt = `The user asked: "${message}"\nHere's their leave history data: ${JSON.stringify(data, null, 2)}\n\nFormat as a markdown table with columns:\n| Place | Reason | Type | From → To | Status |\nUse emojis: ✅ for APPROVED, ❌ for CANCELLED, ⏳ for PENDING`;
          break;
        case 'getleavestatus':
          prompt = `The user asked: "${message}"\nHere's their current leave status: ${JSON.stringify(data, null, 2)}\n\nFormat as a markdown table with columns:\n| Place | Reason | Type | From → To | Status |`;
          break;
        case 'getgrades':
          prompt = `The user asked: "${message}"\nHere's their semester grades data: ${JSON.stringify(data, null, 2)}\n\nCreate a markdown table with columns:\n| Course Code | Course Title | Credits | Total | Grade |\nUse grade emojis: 🌟 for S, ✅ for A, 👍 for B, etc.`;
          break;
        case 'getpaymenthistory':
          prompt = `The user asked: "${message}"\nHere's their payment history: ${JSON.stringify(data, null, 2)}\n\nFormat as a markdown table with columns:\n| Invoice No | Receipt No | Date | Amount | Campus |`;
          break;
        case 'getproctordetails':
          prompt = `The user asked: "${message}"\nHere's their proctor details: ${JSON.stringify(data, null, 2)}\n\nFormat the proctor information in a clean way with emojis like 👨‍🏫, 📧, 📍`;
          break;
        case 'getgradehistory':
          prompt = `The user asked: "${message}"\nHere's their complete grade history: ${JSON.stringify(data, null, 2)}\n\nCreate a comprehensive academic history report with grade distribution, CGPA, credits, curriculum progress, recent courses.`;
          break;
        case 'getcounsellingrank':
          prompt = `The user asked: "${message}"\nHere's their counselling rank details: ${JSON.stringify(data, null, 2)}\n\nFormat the counselling information clearly with emojis: 🎯, 👥, 🎫, ⏰, 📍, 📅`;
          break;
        case 'getfacultyinfo':
          prompt = `The user asked: "${message}"\nHere's the faculty information: ${JSON.stringify(data, null, 2)}\n\nHANDLE THESE SCENARIOS:\n1. If ERROR: Show error message\n2. If MULTIPLE FACULTIES: List all with name, designation, school\n3. If SINGLE FACULTY: Show detailed info with name, designation, department, school, email, cabin, open hours`;
          break;
        case 'getacademiccalendar':
          const currentDate = new Date().toDateString();
          prompt = `The user asked: "${message}"\nCURRENT REAL DATE: ${currentDate}\nHere's the academic calendar data: ${JSON.stringify(data, null, 2)}\n\nIMPORTANT: Use CURRENT DATE (${currentDate}) to answer relative questions. Smart filter: show specific events if asked, full calendar if requested.`;
          break;
        case 'downloadgradehistory':
          prompt = `The user asked: "${message}"\n\nRespond by providing a direct link: [📄 Download Grade History PDF](/api/downloads/grade-history?sessionId=${session.id})`;
          break;
        default:
          prompt = `The user asked: "${message}"\n\nBased on our conversation, answer their question naturally.`;
          break;
      }
    }

    const result = await model.generateContentStream({
      contents: [
        ...recentHistory,
        { role: 'user', parts: [{ text: prompt }] }
      ]
    });

    let fullText = "";
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      res.write(chunkText);
    }

    // Update history and end response
    session.conversationHistory.push({ role: 'model', content: fullText });
    if (session.conversationHistory.length > MAX_HISTORY) {
      session.conversationHistory.shift();
    }
    
    res.end();

  } catch (error) {
    console.error(`[${sessionId}] Chat error:`, error.message || error);
    if (!res.headersSent) {
      res.status(500).json({ 
        response: "I encountered an error processing your request. Please try again.",
        data: null 
      });
    } else {
      res.end();
    }
  }
});

// ===== SESSION ENDPOINT =====
app.get('/api/session', (req, res) => {
  const sessionId = req.query.sessionId;
  const session = getSession(sessionId);
  
  if (!session) {
    return res.json({ isLoggedIn: false });
  }
  
  res.json({
    isLoggedIn: session.isLoggedIn,
    isDemo: session.currentCredentials.isDemo,
    hasCredentials: !!session.currentCredentials.username
  });
});

// ===== LOGOUT ENDPOINT =====
app.post('/api/logout', async (req, res) => {
  const { sessionId } = req.body;
  const session = getSession(sessionId);
  
  if (session) {
    // Clean up the isolated browser session
    const { destroySession } = require('./vtop-auth');
    destroySession(sessionId);
    delete sessions[sessionId];
  }
  
  res.json({ success: true });
});

// ===== APPLY LEAVE ENDPOINT =====
app.post('/api/leave/apply', async (req, res) => {
  try {
    const { leaveType, visitingPlace, fromDate, toDate, fromTime, toTime, reason } = req.body;
    const sessionId = req.body.sessionId || req.sessionID;
    
    const session = getSession(sessionId);
    if (!session || !session.isLoggedIn) {
      return res.json({
        response: 'Session expired. Please refresh the page.',
        data: null
      });
    }
    
    const authData = await getAuthData(sessionId);
    const result = await applyLeave(authData, session, sessionId, {
      leaveType,
      visitingPlace,
      fromDate,
      toDate,
      fromTime,
      toTime,
      reason
    });
    
    res.json(result);
  } catch (error) {
    console.error('Leave application error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// ===== FACULTY SELECTION ENDPOINT =====
app.post('/api/faculty/select', async (req, res) => {
  try {
    const { empId, sessionId } = req.body;
    const session = getSession(sessionId);

    if (!session || !session.isLoggedIn) {
      return res.json({ 
        response: "Session expired. Please refresh the page.",
        data: null 
      });
    }

    const authData = await getAuthData(sessionId);
    const facultyData = await getFacultyDetailsByEmpId(authData, session, sessionId, empId);
    
    res.json({ 
      success: true,
      data: facultyData 
    });

  } catch (error) {
    console.error('Faculty selection error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Papers Search Endpoint
app.post('/api/papers/search', async (req, res) => {
  console.log('\n📚 Papers Search Request Received:');
  console.log('----------------------------------');
  try {
    const { courseCode, courseName, paperType } = req.body;

    console.log('📥 Search parameters:', {
      courseCode: courseCode || '(not provided)',
      courseName: courseName || '(not provided)',
      paperType: paperType || 'all'
    });
    
    if (!courseCode && !courseName) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Please provide either a course code or course name',
          type: 'VALIDATION_ERROR'
        }
      });
    }

    console.log('🔍 Searching multiple sources...');
    
    const [githubResults, codechefResults] = await Promise.allSettled([
      searchPapers({ courseCode, courseName, paperType }),
      searchCodeChefPapers({ courseCode, courseName, paperType })
    ]);

    let allResults = [];
    
    if (githubResults.status === 'fulfilled' && Array.isArray(githubResults.value)) {
      console.log(`✅ GitHub: Found ${githubResults.value.length} papers`);
      allResults.push(...githubResults.value);
    } else {
      console.log('⚠️ GitHub: Failed or rate limited');
    }
    
    if (codechefResults.status === 'fulfilled' && Array.isArray(codechefResults.value)) {
      console.log(`✅ CodeChef: Found ${codechefResults.value.length} papers`);
      allResults.push(...codechefResults.value);
    } else {
      console.log('⚠️ CodeChef: Failed or no results');
    }

    console.log(`📊 Total papers found: ${allResults.length}`);

    res.json({
      success: true,
      totalResults: allResults.length,
      sources: {
        github: githubResults.status === 'fulfilled' ? githubResults.value.length : 0,
        codechef: codechefResults.status === 'fulfilled' ? codechefResults.value.length : 0
      },
      results: allResults.map(paper => ({
        title: paper.title,
        courseCode: paper.courseCode,
        type: paper.examType,
        year: paper.year,
        term: paper.term,
        subject: paper.subject,
        url: paper.downloadUrl,
        source: paper.source || 'GitHub',
        thumbnail: paper.thumbnailUrl || null,
        metadata: paper.metadata || {}
      }))
    });

  } catch (error) {
    console.error('Papers search error:', error.message || error);
    res.status(500).json({
      success: false,
      error: {
        message: "Failed to search papers",
        details: error.message,
        type: "INTERNAL_ERROR"
      }
    });
  }
});

// ===== GRADE HISTORY DOWNLOAD ENDPOINT =====
app.get('/api/downloads/grade-history', async (req, res) => {
    const { sessionId } = req.query;
    const session = getSession(sessionId);

    if (!session || !session.isLoggedIn) {
        return res.status(401).send('Not logged in');
    }

    try {
        console.log(`[${sessionId}] Download request received`);
        const authData = await getAuthData(sessionId);
        
        if (!authData || !authData.authorizedID) {
            console.error(`[${sessionId}] Auth data not available`);
            return res.status(401).send('Authentication data not available');
        }
        
        console.log(`[${sessionId}] Auth data retrieved for ${authData.authorizedID}`);
        const dataBuffer = await downloadGradeHistory(authData, session, sessionId);
        
        // Return raw PDF buffer
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Grade_History.pdf"');
        res.send(dataBuffer);

    } catch (error) {
        console.error(`[${sessionId}] Error downloading grade history:`, error.message);
        res.status(500).send('Failed to download grade history');
    }
});

// ===== DIRECT DATA ENDPOINT (NO AI PROCESSING) =====
// Add this RIGHT BEFORE app.listen() in server.js

app.post('/api/direct-data', async (req, res) => {
  try {
    const { functionId, sessionId, params } = req.body;
    const session = getSession(sessionId);

    if (!session || !session.isLoggedIn) {
      return res.json({ 
        success: false,
        error: 'Session expired. Please refresh the page.' 
      });
    }

    const authData = await getAuthData(sessionId);
    let data = null;

    // Direct function mapping - NO AI INVOLVED
    switch (functionId) {
      case 'cgpa':
        data = await getCGPA(authData, session, sessionId);
        break;
      
      case 'attendance':
        data = await getAttendance(authData, session, sessionId);
        break;
      
      case 'marks':
        data = await getMarks(authData, session, sessionId);
        break;
      
      case 'assignments':
        data = await getAssignments(authData, session, sessionId);
        break;
      
      case 'examSchedule':
        data = await getExamSchedule(authData, session, sessionId);
        break;
      
      case 'timetable':
        data = await getTimetable(authData, session, sessionId);
        break;
      
      case 'leaveHistory':
        data = await getLeaveHistory(authData, session, sessionId);
        break;
      
      case 'leaveStatus':
        data = await getLeaveStatus(authData, session, sessionId);
        break;
      
      case 'grades':
        data = await getGrades(authData, session, sessionId);
        break;
      
      case 'paymentHistory':
        data = await getPaymentHistory(authData, session, sessionId);
        break;
      
      case 'proctorDetails':
        data = await getProctorDetails(authData, session, sessionId);
        break;
      
      case 'gradeHistory':
        data = await getGradeHistory(authData, session, sessionId);
        break;
      
      case 'counsellingRank':
        data = await getCounsellingRank(authData, session, sessionId);
        break;
      
      case 'facultyInfo':
        if (!params?.facultyName) {
          return res.json({ 
            success: false, 
            error: 'Faculty name is required' 
          });
        }
        data = await getFacultyInfo(authData, session, sessionId, params.facultyName);
        break;
      
      case 'academicCalendar':
        data = await getAcademicCalendar(authData, session, sessionId);
        break;
      
      default:
        return res.json({ 
          success: false, 
          error: 'Unknown function' 
        });
    }

    res.json({ 
      success: true, 
      data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`[${req.body.sessionId}] Direct data error:`, error.message || error);
    res.json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Initialize Database
initDB();

app.listen(PORT, () => {
  console.log(`🚀 VTOP Server running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
});
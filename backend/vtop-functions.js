const { getClient, getAuthData, getBaseUrl, getCampus } = require('./vtop-auth');
const cheerio = require('cheerio');

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// ==========================================
// 🛠️ HELPER: Get Correct Semester ID by Campus
// ==========================================
function getDefaultSemesterId(campus) {
  // Normalize campus string just in case
  const c = campus ? campus.toLowerCase() : 'vellore';
  
  // Update these IDs if the semester changes!
  if (c === 'chennai') {
    return 'CH20252605'; // Chennai Fall Semester
  }
  return 'VL20252605';   // Vellore Fall Semester
}

function isCacheValid(session, key) {
  if (!session?.cache?.[key]) return false;
  return session.cache[key].data && (Date.now() - session.cache[key].timestamp) < CACHE_DURATION;
}

async function getCGPA(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'cgpa')) {
      console.log(`[${sessionId}] Cache hit: cgpa`);
      return session.cache.cgpa.data;
    }

    console.log(`[${sessionId}] Fetching CGPA...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    const res = await client.post(
      `${baseUrl}/vtop/get/dashboard/current/cgpa/credits`,
      new URLSearchParams({
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken,
        x: new Date().toUTCString()
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const cgpaData = {};
    
    $('li.list-group-item').each((i, el) => {
      const label = $(el).find('span.card-title').text().trim();
      const value = $(el).find('span.fontcolor3 span').text().trim();
      if (label && value) {
        cgpaData[label] = value;
      }
    });
    
    if (session) {
      session.cache.cgpa = { data: cgpaData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: cgpa`);
    }
    
    console.log(`[${sessionId}] CGPA fetched for ${authData.authorizedID}`);
    return cgpaData;
  } catch (error) {
    console.error(`[${sessionId}] CGPA fetch error:`, error.message);
    throw error;
  }
}

async function getAttendance(authData, session, sessionId, semesterId = null) {
  try {
    if (isCacheValid(session, 'attendance')) {
      console.log(`[${sessionId}] Cache hit: attendance`);
      return session.cache.attendance.data;
    }

    console.log(`[${sessionId}] Fetching Attendance...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    const isChennai = campus === 'chennai';
    
    // Dynamic Semester ID
    const currentSemId = semesterId || getDefaultSemesterId(campus);
    
    const res = await client.post(
      `${baseUrl}/vtop/processViewStudentAttendance`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        semesterSubId: currentSemId,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString()
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const attendanceData = [];

    // 🛠️ STRICT MAPPING (Added 'status' index)
    // Vellore: Status is usually at index 8
    // Chennai: Status is usually at index 12
    const IDX = isChennai ? 
      { type: 3, attended: 9, total: 10, percent: 11, status: 12 } : 
      { type: 2, attended: 5, total: 6, percent: 7, status: 8 };

    // Select Table
    const $table = isChennai ? 
      $('.table-responsive table').first() : 
      $('#AttendanceDetailDataTable');

    if ($table.length === 0) {
      console.log(`[${sessionId}] ⚠️ Warning: Attendance table not found`);
      return [];
    }

    $table.find('tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      
      // Ensure row has enough data
      if (cells.length > IDX.percent) {
        // 1. Extract Basic Data
        const slNo = $(cells[0]).text().trim();
        const courseType = $(cells[IDX.type]).text().trim();
        
        // Fixed Syntax: Logic to determine Course Detail string
        const courseDetail = (campus === 'vellore') 
          ? $(cells[2]).text().trim() 
          : $(cells[1]).text().trim() + " - " + $(cells[2]).text().trim();

        // 2. Extract Debar Status (NEW)
        // We check if the cell exists before trying to read it to avoid crashes
        const debarStatus = cells.length > IDX.status ? $(cells[IDX.status]).text().trim() : 'N/A';
        
        // 3. Parse Numbers
        const attendedClasses = parseFloat($(cells[IDX.attended]).text().trim());
        const totalClasses = parseFloat($(cells[IDX.total]).text().trim());
        const attendancePercentage = $(cells[IDX.percent]).text().trim().replace('%', '');

        if (isNaN(attendedClasses) || isNaN(totalClasses)) return;

        // 4. Calculation Logic
        let classesNeeded = 0;
        let canSkip = 0;
        let alertStatus = 'safe';
        let alertMessage = '';

        const currentPercentage = attendedClasses / totalClasses;
        const isLab = courseType.toLowerCase().includes('lab') || courseDetail.toLowerCase().includes('lab');

        // Threshold 0.7401
        if (currentPercentage < 0.7401) {
          classesNeeded = Math.ceil((0.7401 * totalClasses - attendedClasses) / 0.2599);
          
          if (isLab) {
            classesNeeded = Math.ceil(classesNeeded / 2);
            alertMessage = `${classesNeeded} lab(s) should be attended`;
          } else {
            alertMessage = `${classesNeeded} class(es) should be attended`;
          }
          alertStatus = 'danger';
        } else {
          canSkip = Math.floor((attendedClasses - 0.7401 * totalClasses) / 0.7401);
          
          if (isLab) canSkip = Math.floor(canSkip / 2);
          if (canSkip < 0) canSkip = 0;
          
          alertMessage = isLab ? `Only ${canSkip} lab(s) can be skipped` : `Only ${canSkip} class(es) can be skipped`;
          
          if (currentPercentage >= 0.7401 && currentPercentage <= 0.7499) {
            alertStatus = 'caution';
          } else {
            alertStatus = 'safe';
          }
        }

        if (slNo && !isNaN(parseInt(slNo))) {
          attendanceData.push({
            slNo,
            courseDetail,
            attendedClasses: attendedClasses.toString(),
            totalClasses: totalClasses.toString(),
            attendancePercentage: attendancePercentage + '%',
            debarStatus: debarStatus, // <--- Now using the extracted variable
            classesNeeded,
            canSkip,
            alertStatus,
            alertMessage,
            isLab
          });
        }
      }
    });
    
    if (session) {
      session.cache.attendance = { data: attendanceData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: attendance`);
    }
    
    console.log(`[${sessionId}] Attendance fetched for ${authData.authorizedID}`);
    return attendanceData;
  } catch (error) {
    console.error(`[${sessionId}] Attendance fetch error:`, error.message);
    throw error;
  }
}

async function getMarks(authData, session, sessionId, semesterId = null) {
  try {
    if (isCacheValid(session, 'marks')) {
      console.log(`[${sessionId}] Cache hit: marks`);
      return session.cache.marks.data;
    }

    console.log(`[${sessionId}] Fetching Marks...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    
    // FIX: Dynamic Semester ID
    const currentSemId = semesterId || getDefaultSemesterId(campus);
    
    const res = await client.post(
      `${baseUrl}/vtop/examinations/doStudentMarkView`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        semesterSubId: currentSemId,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString()
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const courses = [];
    const rows = $('tbody tr').toArray();
    
    for (let i = 0; i < rows.length; i++) {
      const row = $(rows[i]);
      if (!row.hasClass('tableContent') || row.find('.customTable-level1').length > 0) continue;
      
      const cells = row.find('td');
      const course = {
        slNo: $(cells[0]).text().trim(),
        courseCode: $(cells[2]).text().trim(),
        courseTitle: $(cells[3]).text().trim(),
        faculty: $(cells[6]).text().trim(),
        slot: $(cells[7]).text().trim(),
        marks: []
      };
      
      const nextRow = $(rows[i + 1]);
      const marksTable = nextRow.find('.customTable-level1 tbody');
      if (marksTable.length > 0) {
        let totMaxMarks = 0;
        let totWeightagePercent = 0;
        let totScored = 0;
        let totWeightageEqui = 0;

        marksTable.find('tr.tableContent-level1').each((j, markRow) => {
          const outputs = $(markRow).find('output');
          const mark = {
            title: $(outputs[1]).text().trim(),
            scored: $(outputs[5]).text().trim(),
            max: $(outputs[2]).text().trim(),
            weightage: $(outputs[6]).text().trim(),
            percent: $(outputs[3]).text().trim()
          };
          course.marks.push(mark);

          totMaxMarks += parseFloat(mark.max) || 0;
          totWeightagePercent += parseFloat(mark.percent) || 0;
          totScored += parseFloat(mark.scored) || 0;
          totWeightageEqui += parseFloat(mark.weightage) || 0;
        });

        const lostWeightage = (totWeightagePercent - totWeightageEqui).toFixed(2);
        course.marks.push({
          title: 'Total',
          scored: totScored.toFixed(2),
          max: totMaxMarks.toFixed(2),
          weightage: totWeightageEqui.toFixed(2),
          percent: totWeightagePercent.toFixed(2),
          lostWeightage: lostWeightage,
          isTotal: true
        });

        const isTheory = course.courseTitle.toLowerCase().includes('theory');
        const isLab = course.courseTitle.toLowerCase().includes('lab') || course.courseTitle.toLowerCase().includes('online');
        const isSTS = course.courseTitle.toLowerCase().includes('soft');

        if (totWeightagePercent == 60) {
          let passMarks = null;
          let passStatus = 'unknown';
          
          if (isTheory) {
            if (totWeightageEqui >= 34) {
              passMarks = 40;
              passStatus = 'safe';
            } else {
              passMarks = ((34 - totWeightageEqui) * 2.5) + 40;
              passStatus = 'danger';
            }
          } else if (isLab || isSTS) {
            if (totWeightageEqui >= 50) {
              passMarks = 'Already passed';
              passStatus = 'safe';
            } else {
              passMarks = (50 - totWeightageEqui).toFixed(2);
              passStatus = 'danger';
            }
          }
          
          course.passingInfo = {
            required: passMarks,
            status: passStatus,
            type: isTheory ? 'Theory' : (isLab ? 'Lab' : (isSTS ? 'STS' : 'Unknown'))
          };
        }
        i++;
      }
      courses.push(course);
    }
    
    if (session) {
      session.cache.marks = { data: courses, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: marks`);
    }
    
    console.log(`[${sessionId}] Marks fetched for ${authData.authorizedID}`);
    return courses;
  } catch (error) {
    console.error(`[${sessionId}] Marks fetch error:`, error.message);
    throw error;
  }
}

async function getAssignments(authData, session, sessionId, semesterId = null) {
  try {
    if (isCacheValid(session, 'assignments')) {
      console.log(`[${sessionId}] Cache hit: assignments`);
      return session.cache.assignments.data;
    }

    console.log(`[${sessionId}] Fetching Assignments...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    
    // FIX: Dynamic Semester ID
    const currentSemId = semesterId || getDefaultSemesterId(campus);
    
    const subRes = await client.post(
      `${baseUrl}/vtop/examinations/doDigitalAssignment`,
      new URLSearchParams({
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString(),
        semesterSubId: currentSemId,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(subRes.data);
    const subjects = [];
    
    $('tbody tr.tableContent').each((i, row) => {
      const cells = $(row).find('td');
      const subject = {
        slNo: $(cells[0]).text().trim(),
        classNbr: $(cells[1]).text().trim(),
        courseCode: $(cells[2]).text().trim(),
        courseTitle: $(cells[3]).text().trim(),
        assignments: []
      };
      
      if (subject.slNo && subject.classNbr) {
        subjects.push(subject);
      }
    });
    
    for (const subject of subjects) {
      try {
        const aRes = await client.post(
          `${baseUrl}/vtop/examinations/processDigitalAssignment`,
          new URLSearchParams({
            _csrf: authData.csrfToken,
            classId: subject.classNbr,
            authorizedID: authData.authorizedID,
            x: new Date().toUTCString()
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': `${baseUrl}/vtop/content`,
              'X-Requested-With': 'XMLHttpRequest'
            }
          }
        );
        
        const $a = cheerio.load(aRes.data);
        const tables = $a('table.customTable');
        
        if (tables.length > 1) {
          $a(tables[1]).find('tbody tr.tableContent').each((j, aRow) => {
            const aCells = $a(aRow).find('td');
            const dueDateStr = $a(aCells[4]).find('span').text().trim() || $a(aCells[4]).text().trim();

            let daysLeft = null;
            let status = '';
            if (dueDateStr && dueDateStr !== '-') {
              try {
                const dateMap = {
                  Jan: '01', Feb: '02', Mar: '03', Apr: '04',
                  May: '05', Jun: '06', Jul: '07', Aug: '08',
                  Sep: '09', Sept: '09', Oct: '10', Nov: '11', Dec: '12'
                };
                
                const parts = dueDateStr.split('-');
                if (parts.length === 3) {
                  const day = parts[0];
                  const month = dateMap[parts[1]];
                  const year = parts[2];
                  
                  const dueDate = new Date(`${year}-${month}-${day}`);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  dueDate.setHours(0, 0, 0, 0);
                  
                  const diffTime = dueDate - today;
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  
                  daysLeft = diffDays;
                  
                  if (diffDays < 0) {
                    status = `${Math.abs(diffDays)} days overdue`;
                  } else if (diffDays === 0) {
                    status = 'Due today!';
                  } else {
                    status = `${diffDays} days left`;
                  }
                }
              } catch (error) {
                console.log(`[${sessionId}] Error parsing date: ${dueDateStr}`);
              }
            }

            const assignment = {
              slNo: $a(aCells[0]).text().trim(),
              title: $a(aCells[1]).text().trim(),
              dueDate: dueDateStr,
              daysLeft: daysLeft,
              status: status
            };
            
            if (assignment.slNo && assignment.title && assignment.title !== 'Title') {
              subject.assignments.push(assignment);
            }
          });
        }
      } catch (error) {
        console.log(`[${sessionId}] Warning: Could not fetch assignments for ${subject.courseCode}`);
      }
    }
    
    const assignmentsData = { subjects };
    
    if (session) {
      session.cache.assignments = { data: assignmentsData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: assignments`);
    }
    
    console.log(`[${sessionId}] Assignments fetched for ${authData.authorizedID}`);
    return assignmentsData;
  } catch (error) {
    console.error(`[${sessionId}] Assignments fetch error:`, error.message);
    throw error;
  }
}

async function getLoginHistory(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'loginHistory')) {
      console.log(`[${sessionId}] Cache hit: loginHistory`);
      return session.cache.loginHistory.data;
    }

    console.log(`[${sessionId}] Fetching Login History...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    const res = await client.post(
      `${baseUrl}/vtop/show/login/history`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString()
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const loginHistory = [];
    
    $('tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length > 0) {
        const entry = {
          date: $(cells[0]).text().trim(),
          time: $(cells[1]).text().trim(),
          ipAddress: $(cells[2]).text().trim(),
          status: $(cells[3]).text().trim()
        };
        if (entry.date) {
          loginHistory.push(entry);
        }
      }
    });
    
    if (session) {
      session.cache.loginHistory = { data: loginHistory, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: loginHistory`);
    }
    
    console.log(`[${sessionId}] Login History fetched for ${authData.authorizedID}`);
    return loginHistory.slice(0, 10);
  } catch (error) {
    console.error(`[${sessionId}] Login History fetch error:`, error.message);
    throw error;
  }
}

async function getExamSchedule(authData, session, sessionId, semesterId = null) {
  try {
    if (isCacheValid(session, 'examSchedule')) {
      console.log(`[${sessionId}] Cache hit: examSchedule`);
      return session.cache.examSchedule.data;
    }

    console.log(`[${sessionId}] Fetching Exam Schedule...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    
    // FIX: Dynamic Semester ID
    const currentSemId = semesterId || getDefaultSemesterId(campus);
    
    await client.post(
      `${baseUrl}/vtop/examinations/StudExamSchedule`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken,
        nocache: new Date().toUTCString()
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const res = await client.post(
      `${baseUrl}/vtop/examinations/doSearchExamScheduleForStudent`,
      new URLSearchParams({
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken,
        semesterSubId: currentSemId
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/examinations/StudExamSchedule`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const examSchedule = {
      FAT: [],
      CAT2: [],
      CAT1: []
    };
    
    let currentExamType = '';
    const rows = $('tbody tr.tableContent');
    
    rows.each((i, row) => {
      const cells = $(row).find('td');
      
      if (cells.length === 1 && $(cells[0]).hasClass('panelHead-secondary')) {
        currentExamType = $(cells[0]).text().trim();
        return;
      }
      
      if (cells.length < 13 || !currentExamType) return;
      
      const examInfo = {
        slNo: $(cells[0]).text().trim(),
        courseCode: $(cells[1]).text().trim(),
        courseTitle: $(cells[2]).text().trim(),
        courseType: $(cells[3]).text().trim(),
        classId: $(cells[4]).text().trim(),
        slot: $(cells[5]).text().trim(),
        examDate: $(cells[6]).text().trim(),
        examSession: $(cells[7]).text().trim(),
        reportingTime: $(cells[8]).text().trim(),
        examTime: $(cells[9]).text().trim(),
        venue: $(cells[10]).find('span').text().trim() || $(cells[10]).text().trim() || '-',
        seatLocation: $(cells[11]).find('span').text().trim() || $(cells[11]).text().trim() || '-',
        seatNo: $(cells[12]).find('span').text().trim() || $(cells[12]).text().trim() || '-'
      };
      
      if (examInfo.slNo && examInfo.courseCode) {
        if (currentExamType === 'FAT') {
          examSchedule.FAT.push(examInfo);
        } else if (currentExamType === 'CAT2') {
          examSchedule.CAT2.push(examInfo);
        } else if (currentExamType === 'CAT1') {
          examSchedule.CAT1.push(examInfo);
        }
      }
    });
    
    if (session) {
      session.cache.examSchedule = { data: examSchedule, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: examSchedule`);
    }
    
    console.log(`[${sessionId}] Exam Schedule fetched for ${authData.authorizedID}`);
    return examSchedule;
  } catch (error) {
    console.error(`[${sessionId}] Exam Schedule fetch error:`, error.message);
    throw error;
  }
}
async function getTimetable(authData, session, sessionId, semesterId = null) {
  try {
    if (isCacheValid(session, 'timetable')) {
      console.log(`[${sessionId}] Cache hit: timetable`);
      return session.cache.timetable.data;
    }

    console.log(`[${sessionId}] Fetching Timetable...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    
    // FIX: Dynamic Semester ID
    const currentSemId = semesterId || getDefaultSemesterId(campus);
    
    const res = await client.post(
      `${baseUrl}/vtop/processViewTimeTable`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        semesterSubId: currentSemId,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString()
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const timetableData = {
      courses: [],
      schedule: {}
    };
    
    const table = $('tbody').first();
    const rows = table.find('tr');
    
    rows.each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length < 9) return;
      const firstCellText = $(cells[0]).text().trim();
      if (firstCellText.includes('Total Number Of Credits')) return;
      if ($(row).find('th').length > 0) return;
      const slNo = $(cells[0]).text().trim();
      if (!slNo || isNaN(parseInt(slNo))) return;
      
      const courseCodeTitle = $(cells[2]).find('p').first().text().trim();
      const slotVenueCell = $(cells[7]);
      const slotVenueParts = slotVenueCell.find('p').map((i, el) => $(el).text().trim()).get();
      const slotVenue = slotVenueParts.join(' ').replace(/\s+/g, ' ').trim();
      const facNameSchoolCell = $(cells[8]);
      const facNameSchoolParts = facNameSchoolCell.find('p').map((i, el) => $(el).text().trim()).get();
      const facNameSchool = facNameSchoolParts.join(' ').replace(/\s+/g, ' ').trim();
      
      if (!courseCodeTitle || courseCodeTitle === '') return;
      
      const codeTitle = courseCodeTitle.split('-');
      const courseCode = codeTitle[0] ? codeTitle[0].trim() : '';
      const courseTitle = codeTitle.slice(1).join('-').trim();
      
      let slot = '';
      let venue = '';
      if (slotVenue.includes('-')) {
        const parts = slotVenue.split('-');
        slot = parts[0].trim();
        venue = parts[1].trim();
      }
      
      let facName = '';
      let facSchool = '';
      if (facNameSchool.includes('-')) {
        const parts = facNameSchool.split('-');
        facName = parts[0].trim();
        facSchool = parts[1].trim();
      }
      
      if (courseCode && slot && slot !== 'NIL' && venue !== 'NIL') {
        timetableData.courses.push({
          courseCode,
          courseTitle,
          slot,
          venue,
          facName,
          facSchool
        });
      }
    });
    
    const slotTimes = {
      'A1': [{ day: 'Monday', time: '08:00 - 09:00 AM' }, { day: 'Wednesday', time: '09:00 - 10:00 AM' }],
      'B1': [{ day: 'Tuesday', time: '08:00 - 09:00 AM' }, { day: 'Thursday', time: '09:00 - 10:00 AM' }],
      'C1': [{ day: 'Wednesday', time: '08:00 - 09:00 AM' }, { day: 'Friday', time: '09:00 - 10:00 AM' }],
      'D1': [{ day: 'Thursday', time: '08:00 - 10:00 AM' }, { day: 'Monday', time: '10:00 - 11:00 AM' }],
      'E1': [{ day: 'Friday', time: '08:00 - 10:00 AM' }, { day: 'Tuesday', time: '10:00 - 11:00 AM' }],
      'F1': [{ day: 'Monday', time: '09:00 - 10:00 AM' }, { day: 'Wednesday', time: '10:00 - 11:00 AM' }],
      'G1': [{ day: 'Tuesday', time: '09:00 - 10:00 AM' }, { day: 'Thursday', time: '10:00 - 11:00 AM' }],
      'A2': [{ day: 'Monday', time: '02:00 - 03:00 PM' }, { day: 'Wednesday', time: '03:00 - 04:00 PM' }],
      'B2': [{ day: 'Tuesday', time: '02:00 - 03:00 PM' }, { day: 'Thursday', time: '03:00 - 04:00 PM' }],
      'C2': [{ day: 'Wednesday', time: '02:00 - 03:00 PM' }, { day: 'Friday', time: '03:00 - 04:00 PM' }],
      'D2': [{ day: 'Thursday', time: '02:00 - 04:00 PM' }, { day: 'Monday', time: '04:00 - 05:00 PM' }],
      'E2': [{ day: 'Friday', time: '02:00 - 04:00 PM' }, { day: 'Tuesday', time: '04:00 - 05:00 PM' }],
      'F2': [{ day: 'Monday', time: '03:00 - 04:00 PM' }, { day: 'Wednesday', time: '04:00 - 05:00 PM' }],
      'G2': [{ day: 'Tuesday', time: '03:00 - 04:00 PM' }, { day: 'Thursday', time: '04:00 - 05:00 PM' }],
      'TA1': [{ day: 'Friday', time: '10:00 - 11:00 AM' }],
      'TB1': [{ day: 'Monday', time: '11:00 - 12:00 PM' }],
      'TC1': [{ day: 'Tuesday', time: '11:00 - 12:00 PM' }],
      'TD1': [{ day: 'Friday', time: '12:00 - 01:00 PM' }],
      'TE1': [{ day: 'Thursday', time: '11:00 - 12:00 PM' }],
      'TF1': [{ day: 'Friday', time: '11:00 - 12:00 PM' }],
      'TG1': [{ day: 'Monday', time: '12:00 - 01:00 PM' }],
      'TAA1': [{ day: 'Tuesday', time: '12:00 - 01:00 PM' }],
      'TCC1': [{ day: 'Thursday', time: '12:00 - 01:00 PM' }],
      'TA2': [{ day: 'Friday', time: '04:00 - 05:00 PM' }],
      'TB2': [{ day: 'Monday', time: '05:00 - 06:00 PM' }],
      'TC2': [{ day: 'Tuesday', time: '05:00 - 06:00 PM' }],
      'TD2': [{ day: 'Wednesday', time: '05:00 - 06:00 PM' }],
      'TE2': [{ day: 'Thursday', time: '05:00 - 06:00 PM' }],
      'TF2': [{ day: 'Friday', time: '05:00 - 06:00 PM' }],
      'TG2': [{ day: 'Monday', time: '06:00 - 07:00 PM' }],
      'TAA2': [{ day: 'Tuesday', time: '06:00 - 07:00 PM' }],
      'TBB2': [{ day: 'Wednesday', time: '06:00 - 07:00 PM' }],
      'TCC2': [{ day: 'Thursday', time: '06:00 - 07:00 PM' }],
      'TDD2': [{ day: 'Friday', time: '06:00 - 07:00 PM' }],
      'L1': [{ day: 'Monday', time: '08:00 - 09:50 AM' }],
      'L3': [{ day: 'Monday', time: '09:51 - 11:40 AM' }],
      'L5': [{ day: 'Monday', time: '11:40 AM - 01:30 PM' }],
      'L7': [{ day: 'Tuesday', time: '08:00 - 09:50 AM' }],
      'L9': [{ day: 'Tuesday', time: '09:51 - 11:40 AM' }],
      'L11': [{ day: 'Tuesday', time: '11:40 AM - 01:30 PM' }],
      'L13': [{ day: 'Wednesday', time: '08:00 - 09:50 AM' }],
      'L15': [{ day: 'Wednesday', time: '09:51 - 11:40 AM' }],
      'L17': [{ day: 'Wednesday', time: '11:40 AM - 01:30 PM' }],
      'L19': [{ day: 'Thursday', time: '08:00 - 09:50 AM' }],
      'L21': [{ day: 'Thursday', time: '09:51 - 11:40 AM' }],
      'L23': [{ day: 'Thursday', time: '11:40 AM - 01:30 PM' }],
      'L25': [{ day: 'Friday', time: '08:00 - 09:50 AM' }],
      'L27': [{ day: 'Friday', time: '09:51 - 11:40 AM' }],
      'L29': [{ day: 'Friday', time: '11:40 AM - 01:30 PM' }],
      'L31': [{ day: 'Monday', time: '02:00 - 03:50 PM' }],
      'L33': [{ day: 'Monday', time: '03:51 - 05:40 PM' }],
      'L35': [{ day: 'Monday', time: '05:40 - 07:30 PM' }],
      'L37': [{ day: 'Tuesday', time: '02:00 - 03:50 PM' }],
      'L39': [{ day: 'Tuesday', time: '03:51 - 05:40 PM' }],
      'L41': [{ day: 'Tuesday', time: '05:40 - 07:30 PM' }],
      'L43': [{ day: 'Wednesday', time: '02:00 - 03:50 PM' }],
      'L45': [{ day: 'Wednesday', time: '03:51 - 05:40 PM' }],
      'L47': [{ day: 'Wednesday', time: '05:40 - 07:30 PM' }],
      'L49': [{ day: 'Thursday', time: '02:00 - 03:50 PM' }],
      'L51': [{ day: 'Thursday', time: '03:51 - 05:40 PM' }],
      'L53': [{ day: 'Thursday', time: '05:40 - 07:30 PM' }],
      'L55': [{ day: 'Friday', time: '02:00 - 03:50 PM' }],
      'L57': [{ day: 'Friday', time: '03:51 - 05:40 PM' }],
      'L59': [{ day: 'Friday', time: '05:40 - 07:30 PM' }],
      'L2': [{ day: 'Monday', time: '08:00 - 09:50 AM' }],
      'L4': [{ day: 'Monday', time: '09:51 - 11:40 AM' }],
      'L6': [{ day: 'Monday', time: '11:40 AM - 01:30 PM' }],
      'L8': [{ day: 'Tuesday', time: '08:00 - 09:50 AM' }],
      'L10': [{ day: 'Tuesday', time: '09:51 - 11:40 AM' }],
      'L12': [{ day: 'Tuesday', time: '11:40 AM - 01:30 PM' }],
      'L14': [{ day: 'Wednesday', time: '08:00 - 09:50 AM' }],
      'L16': [{ day: 'Wednesday', time: '09:51 - 11:40 AM' }],
      'L18': [{ day: 'Wednesday', time: '11:40 AM - 01:30 PM' }],
      'L20': [{ day: 'Thursday', time: '08:00 - 09:50 AM' }],
      'L22': [{ day: 'Thursday', time: '09:51 - 11:40 AM' }],
      'L24': [{ day: 'Thursday', time: '11:40 AM - 01:30 PM' }],
      'L26': [{ day: 'Friday', time: '08:00 - 09:50 AM' }],
      'L28': [{ day: 'Friday', time: '09:51 - 11:40 AM' }],
      'L30': [{ day: 'Friday', time: '11:40 AM - 01:30 PM' }],
      'L32': [{ day: 'Monday', time: '02:00 - 03:50 PM' }],
      'L34': [{ day: 'Monday', time: '03:51 - 05:40 PM' }],
      'L36': [{ day: 'Monday', time: '05:40 - 07:30 PM' }],
      'L38': [{ day: 'Tuesday', time: '02:00 - 03:50 PM' }],
      'L40': [{ day: 'Tuesday', time: '03:51 - 05:40 PM' }],
      'L42': [{ day: 'Tuesday', time: '05:40 - 07:30 PM' }],
      'L44': [{ day: 'Wednesday', time: '02:00 - 03:50 PM' }],
      'L46': [{ day: 'Wednesday', time: '03:51 - 05:40 PM' }],
      'L48': [{ day: 'Wednesday', time: '05:40 - 07:30 PM' }],
      'L50': [{ day: 'Thursday', time: '02:00 - 03:50 PM' }],
      'L52': [{ day: 'Thursday', time: '03:51 - 05:40 PM' }],
      'L54': [{ day: 'Thursday', time: '05:40 - 07:30 PM' }],
      'L56': [{ day: 'Friday', time: '02:00 - 03:50 PM' }],
      'L58': [{ day: 'Friday', time: '03:51 - 05:40 PM' }],
      'L60': [{ day: 'Friday', time: '05:40 - 07:30 PM' }]
    };
    
    timetableData.schedule = {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: []
    };
    
    timetableData.courses.forEach(course => {
      const slots = course.slot.split('+');
      slots.forEach(slot => {
        const slotInfo = slotTimes[slot];
        if (slotInfo) {
          slotInfo.forEach(timeSlot => {
            timetableData.schedule[timeSlot.day].push({
              courseCode: course.courseCode,
              courseTitle: course.courseTitle,
              slot: slot,
              time: timeSlot.time,
              venue: course.venue,
              faculty: course.facName
            });
          });
        } else {
          console.log(`[${sessionId}] Warning: Unknown slot "${slot}" for course ${course.courseCode}`);
        }
      });
    });
    
    Object.keys(timetableData.schedule).forEach(day => {
      timetableData.schedule[day].sort((a, b) => {
        const timeA = a.time.split(' - ')[0];
        const timeB = b.time.split(' - ')[0];
        return timeA.localeCompare(timeB);
      });
    });
    
    if (session) {
      session.cache.timetable = { data: timetableData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: timetable`);
    }
    
    console.log(`[${sessionId}] Timetable fetched for ${authData.authorizedID}`);
    return timetableData;
  } catch (error) {
    console.error(`[${sessionId}] Timetable fetch error:`, error.message);
    throw error;
  }
}

async function getLeaveHistory(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'leaveHistory')) {
      console.log(`[${sessionId}] Cache hit: leaveHistory`);
      return session.cache.leaveHistory.data;
    }

    console.log(`[${sessionId}] Fetching Leave History...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    await client.post(
      `${baseUrl}/vtop/hostels/student/leave/1`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const res = await client.post(
      `${baseUrl}/vtop/hostels/student/leave/6`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        authorizedID: authData.authorizedID,
        history: '',
        form: 'undefined',
        control: 'history'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/hostels/student/leave/1`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const leaveHistory = [];
    
    $('#LeaveHistoryTable tbody tr').each((i, row) => {
      const allCells = $(row).find('td');
      if (allCells.length >= 7) {
        const leave = {
          place: $(allCells[1]).text().trim(),
          reason: $(allCells[2]).text().trim(),
          type: $(allCells[3]).text().trim(),
          from: $(allCells[4]).text().trim(),
          to: $(allCells[5]).text().trim(),
          status: $(allCells[6]).text().trim()
        };
        if (leave.place) {
          leaveHistory.push(leave);
        }
      }
    });
    
    if (session) {
      session.cache.leaveHistory = { data: leaveHistory, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: leaveHistory`);
    }
    
    console.log(`[${sessionId}] Leave History fetched for ${authData.authorizedID}`);
    return leaveHistory;
  } catch (error) {
    console.error(`[${sessionId}] Leave History fetch error:`, error.message);
    throw error;
  }
}

async function getGrades(authData, session, sessionId, semesterId = 'VL20252601') {
  try {
    if (isCacheValid(session, 'grades')) {
      console.log(`[${sessionId}] Cache hit: grades`);
      return session.cache.grades.data;
    }

    console.log(`[${sessionId}] Fetching Grades...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    
    // FIX: Dynamic Semester ID or Default if null
    // Note: Grades often use previous sem ID, so check if CHENNAI needs diff ID here
    // For now, using same logic or default fallback
    const currentSemId = semesterId || getDefaultSemesterId(campus);

    await client.post(
      `${baseUrl}/vtop/examinations/examGradeView/StudentGradeView`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const res = await client.post(
      `${baseUrl}/vtop/examinations/examGradeView/doStudentGradeView`,
      new URLSearchParams({
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken,
        semesterSubId: currentSemId
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/examinations/examGradeView/StudentGradeView`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const grades = [];
    let gpa = '';
    
    const tables = $('table');
    let targetTable = null;
    
    tables.each((i, table) => {
      const headerText = $(table).find('th').text();
      if (headerText.includes('Course Code') || headerText.includes('Grade')) {
        targetTable = $(table);
      }
    });
    
    if (!targetTable) {
      targetTable = $('table.table-hover, table.table-bordered').first();
    }
    
    targetTable.find('tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      
      if (cells.length === 1 && $(cells[0]).attr('colspan')) {
        gpa = $(cells[0]).text().trim();
        return;
      }
      
      if (cells.length < 11) return;
      
      const slNo = $(cells[0]).text().trim();
      if (!slNo || slNo === 'Sl.No.' || isNaN(parseInt(slNo))) return;
      
      const grade = {
        slNo: slNo,
        courseCode: $(cells[1]).text().trim(),
        courseTitle: $(cells[2]).text().trim(),
        courseType: $(cells[3]).text().trim(),
        creditsL: $(cells[4]).text().trim(),
        creditsP: $(cells[5]).text().trim(),
        creditsJ: $(cells[6]).text().trim(),
        creditsC: $(cells[7]).text().trim(),
        gradingType: $(cells[8]).text().trim(),
        total: $(cells[9]).text().trim(),
        grade: $(cells[10]).text().trim()
      };
      
      if (grade.courseCode) {
        grades.push(grade);
      }
    });
    
    const gradesData = { grades, gpa };
    
    if (session) {
      session.cache.grades = { data: gradesData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: grades`);
    }
    
    console.log(`[${sessionId}] Grades fetched for ${authData.authorizedID}`);
    return gradesData;
  } catch (error) {
    console.error(`[${sessionId}] Grades fetch error:`, error.message);
    throw error;
  }
}

async function getPaymentHistory(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'paymentHistory')) {
      console.log(`[${sessionId}] Cache hit: paymentHistory`);
      return session.cache.paymentHistory.data;
    }

    console.log(`[${sessionId}] Fetching Payment History...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    const res = await client.post(
      `${baseUrl}/vtop/finance/getStudentReceipts`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const payments = [];
    let totalAmount = 0;
    
    $('table tbody tr').each((i, row) => {
      if ($(row).hasClass('table-info')) return;
      
      const cells = $(row).find('td');
      
      if (cells.length >= 5) {
        const payment = {
          invoiceNum: $(cells[0]).text().trim(),
          receiptNum: $(cells[1]).text().trim(),
          date: $(cells[2]).text().trim(),
          amount: $(cells[3]).text().trim(),
          campus: $(cells[4]).text().trim()
        };
        
        if (payment.invoiceNum) {
          const amountVal = parseFloat(payment.amount.replace(/,/g, '')) || 0;
          totalAmount += amountVal;
          payments.push(payment);
        }
      }
    });
    
    const paymentData = { payments, totalAmount };
    
    if (session) {
      session.cache.paymentHistory = { data: paymentData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: paymentHistory`);
    }
    
    console.log(`[${sessionId}] Payment History fetched for ${authData.authorizedID}`);
    return paymentData;
  } catch (error) {
    console.error(`[${sessionId}] Payment History fetch error:`, error.message);
    throw error;
  }
}

async function getProctorDetails(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'proctorDetails')) {
      console.log(`[${sessionId}] Cache hit: proctorDetails`);
      return session.cache.proctorDetails.data;
    }

    console.log(`[${sessionId}] Fetching Proctor Details...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    const res = await client.post(
      `${baseUrl}/vtop/proctor/viewProctorDetails`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const proctorDetails = {};
    
    $('table.table tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      
      if (cells.length >= 2) {
        const label = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();
        
        if (label && value && !label.includes('Image')) {
          proctorDetails[label] = value;
        }
      }
    });
    
    if (session) {
      session.cache.proctorDetails = { data: proctorDetails, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: proctorDetails`);
    }
    
    console.log(`[${sessionId}] Proctor Details fetched for ${authData.authorizedID}`);
    return proctorDetails;
  } catch (error) {
    console.error(`[${sessionId}] Proctor Details fetch error:`, error.message);
    throw error;
  }
}

async function getGradeHistory(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'gradeHistory')) {
      console.log(`[${sessionId}] Cache hit: gradeHistory`);
      return session.cache.gradeHistory.data;
    }

    console.log(`[${sessionId}] Fetching Grade History...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    const res = await client.post(
      `${baseUrl}/vtop/examinations/examGradeView/StudentGradeHistory`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    
    const gradeCount = {
      'S': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'E': 0, 'F': 0, 'P': 0, 'N': 0
    };
    
    let totalCredits = 0;
    let earnedCredits = 0;
    const courses = [];
    
    $('table.customTable tbody tr.tableContent').each((i, row) => {
      const cells = $(row).find('td');
      
      if ($(row).attr('id')?.includes('detailsView') || cells.length < 9) return;
      
      const slNo = $(cells[0]).text().trim();
      
      if (slNo && !isNaN(slNo)) {
        const course = {
          slNo: slNo,
          courseCode: $(cells[1]).text().trim(),
          courseTitle: $(cells[2]).text().trim(),
          courseType: $(cells[3]).text().trim(),
          credits: $(cells[4]).text().trim(),
          grade: $(cells[5]).text().trim(),
          examMonth: $(cells[6]).text().trim(),
          resultDeclared: $(cells[7]).text().trim(),
          distribution: $(cells[8]).text().trim()
        };
        
        if (course.courseCode) {
          courses.push(course);
          
          const creditVal = parseFloat(course.credits) || 0;
          totalCredits += creditVal;
          
          if (course.grade && course.grade !== '-' && gradeCount.hasOwnProperty(course.grade)) {
            gradeCount[course.grade]++;
            
            if (course.grade !== 'F' && course.grade !== 'N') {
              earnedCredits += creditVal;
            }
          }
        }
      }
    });
    
    let cgpa = '0.00';
    $('table.table.table-hover.table-bordered tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 3) {
        cgpa = $(cells[2]).text().trim();
      }
    });
    
    const curriculum = [];
    $('table.customTable').eq(1).find('tbody tr.tableContent').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length === 3) {
        const type = $(cells[0]).find('span').first().text().trim();
        const required = $(cells[1]).text().trim();
        const earned = $(cells[2]).text().trim();
        
        if (type && !type.includes('Total Credits')) {
          curriculum.push({ type, required, earned });
        }
      }
    });
    
    const gradeHistoryData = {
      courses,
      gradeCount,
      totalCredits,
      earnedCredits,
      cgpa,
      curriculum
    };
    
    if (session) {
      session.cache.gradeHistory = { data: gradeHistoryData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: gradeHistory`);
    }
    
    console.log(`[${sessionId}] Grade History fetched for ${authData.authorizedID}`);
    return gradeHistoryData;
  } catch (error) {
    console.error(`[${sessionId}] Grade History fetch error:`, error.message);
    throw error;
  }
}

async function getCounsellingRank(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'counsellingRank')) {
      console.log(`[${sessionId}] Cache hit: counsellingRank`);
      return session.cache.counsellingRank.data;
    }

    console.log(`[${sessionId}] Fetching Counselling Rank...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    const res = await client.post(
      `${baseUrl}/vtop/hostels/counsellingSlotTimings`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const details = {};
    
    $('table.table-success tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();
        details[label] = value;
      }
    });
    
    if (session) {
      session.cache.counsellingRank = { data: details, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: counsellingRank`);
    }
    
    console.log(`[${sessionId}] Counselling Rank fetched for ${authData.authorizedID}`);
    return details;
  } catch (error) {
    console.error(`[${sessionId}] Counselling Rank fetch error:`, error.message);
    throw error;
  }
}

async function getFacultyInfo(authData, session, sessionId, facultyName) {
  try {
    console.log(`[${sessionId}] Fetching Faculty Info for: ${facultyName}`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    if (!facultyName || facultyName.length < 3) {
      return { error: 'Please provide at least 3 characters of the faculty name', faculties: [] };
    }
    
    await client.post(
      `${baseUrl}/vtop/hrms/employeeSearchForStudent`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log(`[${sessionId}] Searching with query: ${facultyName.toLowerCase()}`);
    const searchRes = await client.post(
      `${baseUrl}/vtop/hrms/EmployeeSearchForStudent`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString(),
        empId: facultyName.toLowerCase()
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/hrms/employeeSearchForStudent`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $search = cheerio.load(searchRes.data);
    const faculties = [];
    
    $search('table tbody tr').each((i, row) => {
      if (i === 0) return;
      
      const cells = $search(row).find('td');
      if (cells.length >= 4) {
        const name = $search(cells[0]).text().trim();
        const designation = $search(cells[1]).text().trim();
        const school = $search(cells[2]).text().trim();
        const button = $search(cells[3]).find('button');
        const empId = button.attr('id') || button.attr('onclick')?.match(/getEmployeeIdNo\(["']([^"']+)["']\)/)?.[1];
        
        if (name && empId) {
          faculties.push({ name, designation, school, empId });
        }
      }
    });
    
    if (faculties.length === 0) {
      return { 
        error: `No faculty found matching "${facultyName}". Please check the spelling and try again.`, 
        faculties: [] 
      };
    }
    
    if (faculties.length > 1) {
      return { 
        faculties, 
        requiresSelection: true,
        message: `Found ${faculties.length} faculty members. Please specify which one you'd like to know about.`
      };
    }
    
    const selectedFaculty = faculties[0];
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const detailsRes = await client.post(
      `${baseUrl}/vtop/hrms/EmployeeSearch1ForStudent`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString(),
        empId: selectedFaculty.empId
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/hrms/employeeSearchForStudent`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(detailsRes.data);
    const details = {};
    
    $('table.table-bordered').first().find('tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const label = $(cells[0]).find('b').text().trim();
        const value = $(cells[1]).text().trim();
        
        if (label && value && !label.includes('Image')) {
          details[label] = value;
        }
      }
    });
    
    const openHours = [];
    $('table.table-bordered').last().find('tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const day = $(cells[0]).text().trim();
        const timing = $(cells[1]).text().trim();
        if (day && timing && day !== 'Week Day') {
          openHours.push({ day, timing });
        }
      }
    });
    
    const facultyData = {
      name: selectedFaculty.name,
      designation: selectedFaculty.designation,
      school: selectedFaculty.school,
      empId: selectedFaculty.empId,
      details,
      openHours
    };
    
    return facultyData;
  } catch (error) {
    console.error(`[${sessionId}] Faculty Info fetch error:`, error.message);
    throw error;
  }
}

async function getAcademicCalendar(authData, session, sessionId, semesterId = null) {
  try {
    if (isCacheValid(session, 'academicCalendar')) {
      console.log(`[${sessionId}] Cache hit: academicCalendar`);
      return session.cache.academicCalendar.data;
    }

    console.log(`[${sessionId}] Fetching Academic Calendar...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    
    // FIX: Dynamic Semester ID
    // FIX: Dynamic Semester ID
const currentSemId = semesterId || (campus === 'chennai' ? 'CH20252605' : 'VL20252605');
    
    await client.post(
      `${baseUrl}/vtop/academics/common/CalendarPreview`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await client.post(
      `${baseUrl}/vtop/getDateForSemesterPreview`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        paramReturnId: 'getDateForSemesterPreview',
        semSubId: currentSemId,
        authorizedID: authData.authorizedID
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/academics/common/CalendarPreview`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await client.post(
      `${baseUrl}/vtop/getListForSemester`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        paramReturnId: 'getListForSemester',
        semSubId: currentSemId,
        classGroupId: 'ALL',
        authorizedID: authData.authorizedID
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/academics/common/CalendarPreview`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const months = [
      { name: 'DECEMBER', date: '01-DEC-2025', classGroup: 'ALL' },
      { name: 'JANUARY', date: '01-JAN-2026', classGroup: 'ALL' },
      { name: 'FEBRUARY', date: '01-FEB-2026', classGroup: 'ALL' },
      { name: 'MARCH', date: '01-MAR-2026', classGroup: 'ALL' },
      { name: 'APRIL', date: '01-APR-2026', classGroup: 'ALL' }
    ];
    
    const calendar = {};
    
    for (const month of months) {
      try {
        console.log(`[${sessionId}] Fetching ${month.name}...`);
        
        const res = await client.post(
          `${baseUrl}/vtop/processViewCalendar`,
          new URLSearchParams({
            _csrf: authData.csrfToken,
            calDate: month.date,
            semSubId: currentSemId,
            classGroupId: month.classGroup,
            authorizedID: authData.authorizedID
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': `${baseUrl}/vtop/academics/common/CalendarPreview`,
              'X-Requested-With': 'XMLHttpRequest'
            }
          }
        );
        
        const $ = cheerio.load(res.data);
        const events = [];
        
        $('table.calendar-table tbody tr').each((i, row) => {
          if ($(row).find('th').length > 0) return;
          
          $(row).find('td').each((j, cell) => {
            const daySpan = $(cell).find('span').first();
            const day = daySpan.text().trim();
            
            if (!day || isNaN(parseInt(day))) return;
            
            const greenSpans = $(cell).find('span[style*="color: green"], span[style*="color:green"]');
            
            if (greenSpans.length > 0) {
              greenSpans.each((k, eventSpan) => {
                const eventText = $(eventSpan).text().trim();
                const nextSpan = $(eventSpan).next('span[style*="color"]');
                const eventNote = nextSpan.text().trim();
                
                if (eventText) {
                  events.push({
                    day: parseInt(day),
                    event: eventText,
                    note: eventNote || ''
                  });
                }
              });
            }
            
            const otherSpans = $(cell).find('span[style*="color"]').not('[style*="color: green"]').not('[style*="color:green"]').not('[style*="color: #000"]').not('[style*="color:#000"]');
            
            if (otherSpans.length > 0) {
              otherSpans.each((k, eventSpan) => {
                const eventText = $(eventSpan).text().trim();
                
                if (eventText === day || !eventText) return;
                
                const alreadyExists = events.some(e => e.day === parseInt(day) && e.event === eventText);
                
                if (!alreadyExists && eventText.length > 3) {
                  events.push({
                    day: parseInt(day),
                    event: eventText,
                    note: ''
                  });
                }
              });
            }
          });
        });
        
        events.sort((a, b) => a.day - b.day);
        calendar[month.name] = events;
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.log(`[${sessionId}] Could not fetch ${month.name} calendar: ${error.message}`);
        calendar[month.name] = [];
      }
    }
    
    let totalInstructionalDays = 0;
    let totalNonInstructionalDays = 0;
    let totalHolidays = 0;
    let totalExams = 0;
    let totalEvents = 0;
    
    for (const events of Object.values(calendar)) {
      totalEvents += events.length;
      
      events.forEach(event => {
        const eventLower = event.event.toLowerCase();
        
        if (eventLower.includes('instructional')) {
          totalInstructionalDays++;
        } else if (eventLower.includes('holiday') || eventLower.includes('festival')) {
          totalHolidays++;
        } else if (eventLower.includes('exam') || eventLower.includes('cat') || eventLower.includes('fat')) {
          totalExams++;
        } else if (eventLower.includes('non-instructional') || eventLower.includes('no class') || 
                   eventLower.includes('vacation') || eventLower.includes('break')) {
          totalNonInstructionalDays++;
        }
      });
    }
    
    const calendarData = {
      calendar,
      summary: {
        totalEvents,
        totalInstructionalDays,
        totalNonInstructionalDays,
        totalHolidays,
        totalExams,
        monthsCovered: months.length
      }
    };
    
    if (session) {
      session.cache.academicCalendar = { data: calendarData, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: academicCalendar`);
    }
    
    console.log(`[${sessionId}] Academic Calendar fetched for ${authData.authorizedID}`);
    return calendarData;
  } catch (error) {
    console.error(`[${sessionId}] Academic Calendar fetch error:`, error.message);
    throw error;
  }
}

async function getLeaveStatus(authData, session, sessionId) {
  try {
    if (isCacheValid(session, 'leaveStatus')) {
      console.log(`[${sessionId}] Cache hit: leaveStatus`);
      return session.cache.leaveStatus.data;
    }

    console.log(`[${sessionId}] Fetching Leave Status...`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    await client.post(
      `${baseUrl}/vtop/hostels/student/leave/1`,
      new URLSearchParams({
        verifyMenu: 'true',
        authorizedID: authData.authorizedID,
        _csrf: authData.csrfToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/content`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const res = await client.post(
      `${baseUrl}/vtop/hostels/student/leave/4`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        authorizedID: authData.authorizedID,
        status: '',
        form: 'undefined',
        control: 'status'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/hostels/student/leave/1`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(res.data);
    const leaveStatus = [];
    
    $('#LeaveAppliedTable tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 8) {
        const leave = {
          slNo: $(cells[0]).text().trim(),
          place: $(cells[2]).text().trim(),
          reason: $(cells[3]).text().trim(),
          type: $(cells[4]).text().trim(),
          from: $(cells[5]).text().trim(),
          to: $(cells[6]).text().trim(),
          status: $(cells[7]).text().trim()
        };
        
        if (leave.place) {
          leaveStatus.push(leave);
        }
      }
    });
    
    if (session) {
      session.cache.leaveStatus = { data: leaveStatus, timestamp: Date.now() };
      console.log(`[${sessionId}] Cache set: leaveStatus`);
    }
    
    console.log(`[${sessionId}] Leave Status fetched for ${authData.authorizedID}`);
    return leaveStatus;
  } catch (error) {
    console.error(`[${sessionId}] Leave Status fetch error:`, error.message);
    throw error;
  }
}

async function getFacultyDetailsByEmpId(authData, session, sessionId, empId) {
  try {
    console.log(`[${sessionId}] Fetching Faculty Details for empId: ${empId}`);
    const client = getClient(sessionId);
    const baseUrl = getBaseUrl(getCampus(sessionId));
    
    const detailsRes = await client.post(
      `${baseUrl}/vtop/hrms/EmployeeSearch1ForStudent`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString(),
        empId: empId
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/hrms/employeeSearchForStudent`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    const $ = cheerio.load(detailsRes.data);
    const details = {};
    
    $('table.table-bordered').first().find('tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const label = $(cells[0]).find('b').text().trim();
        const value = $(cells[1]).text().trim();
        
        if (label && value && !label.includes('Image')) {
          details[label] = value;
        }
      }
    });
    
    const openHours = [];
    $('table.table-bordered').last().find('tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const day = $(cells[0]).text().trim();
        const timing = $(cells[1]).text().trim();
        if (day && timing && day !== 'Week Day') {
          openHours.push({ day, timing });
        }
      }
    });
    
    const facultyData = {
      details,
      openHours
    };
    
    return facultyData;
  } catch (error) {
    console.error(`[${sessionId}] Faculty Details fetch error:`, error.message);
    throw error;
  }
}

async function downloadGradeHistory(authData, session, sessionId) {
  try {
    console.log(`[${sessionId}] Downloading Grade History...`);
    const client = getClient(sessionId);
    const campus = getCampus(sessionId);
    const baseUrl = getBaseUrl(campus);
    
    const res = await client.post(
      `${baseUrl}/vtop/examinations/examGradeView/doDownloadStudentHistory`,
      new URLSearchParams({
        _csrf: authData.csrfToken,
        authorizedID: authData.authorizedID,
        x: new Date().toUTCString()
      }),
      {
        responseType: 'arraybuffer',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${baseUrl}/vtop/examinations/examGradeView/StudentGradeHistory`,
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );
    
    console.log(`[${sessionId}] Grade History downloaded for ${authData.authorizedID}`);
    return res.data;
  } catch (error) {
    console.error(`[${sessionId}] Grade History download error:`, error.message);
    throw error;
  }
}

module.exports = {
  getCGPA,
  getAttendance,
  getMarks,
  getAssignments,
  getLoginHistory,
  getExamSchedule,
  getTimetable,
  getLeaveHistory,
  getGrades,
  getPaymentHistory,
  getProctorDetails,
  getGradeHistory,
  downloadGradeHistory,
  getCounsellingRank,
  getFacultyInfo,
  getFacultyDetailsByEmpId,
  getAcademicCalendar,
  getLeaveStatus
};
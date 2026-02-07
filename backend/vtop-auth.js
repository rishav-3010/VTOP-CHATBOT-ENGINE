const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');
const { solveUsingViboot } = require('./captcha/captchaSolver');

// Store separate clients per session
const sessionClients = new Map();

// Optimized CSRF for simple strings (Faster than cheerio)
const getCsrfFast = (html) => {
  return html.match(/name="_csrf"\s+content="([^"]+)"/)?.[1] || 
         html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
};

const getCsrf = (html) => {
  const $ = cheerio.load(html);
  return $('meta[name="_csrf"]').attr('content') || $('input[name="_csrf"]').val();
};

// Create a new isolated client for each session
function createSessionClient() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  }));

  return {
    client,
    csrf: null,
    authID: null
  };
}

// Get or create session client
function getSessionClient(sessionId) {
  if (!sessionClients.has(sessionId)) {
    sessionClients.set(sessionId, createSessionClient());
  }
  return sessionClients.get(sessionId);
}

// Get base URL based on campus
function getBaseUrl(campus = 'vellore') {
  return campus === 'chennai' ? 'https://vtopcc.vit.ac.in' : 'https://vtop.vit.ac.in';
}

// Clean up session
function destroySession(sessionId) {
  sessionClients.delete(sessionId);
  console.log(`Session ${sessionId} destroyed`);
}

async function loginToVTOP(username, password, sessionId, campus = 'vellore') {
  const MAX_CAPTCHA_ATTEMPTS = 3;
  const sessionData = getSessionClient(sessionId);
  const { client } = sessionData;
  const baseUrl = getBaseUrl(campus);
  
  // Store campus in session data
  sessionData.campus = campus;
  
  for (let captchaAttempt = 1; captchaAttempt <= MAX_CAPTCHA_ATTEMPTS; captchaAttempt++) {
    try {
      // 1. Init: Use Fast Regex here to save time on the heavy first load
      const init = await client.get(`${baseUrl}/vtop/open/page`);
      let csrf = getCsrfFast(init.data); 
      
      const setup = await client.post(
        `${baseUrl}/vtop/prelogin/setup`,
        new URLSearchParams({ _csrf: csrf, flag: 'VTOP' }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `${baseUrl}/vtop/open/page`,
            'Origin': baseUrl
          }
        }
      );
      
      // // Use original cheerio logic for consistency as requested
      // csrf = getCsrf(setup.data) || csrf;
      
      let captchaBuffer, setupHtml = setup.data, attempts = 0;
      
      // --- YOUR ORIGINAL CAPTCHA LOGIC STARTS ---
      while (!captchaBuffer && attempts++ < 10) {
        const $ = cheerio.load(setupHtml);
        const src = $('img[src^="data:image"]').attr('src');
        
        if (src?.startsWith('data:image')) {
          captchaBuffer = Buffer.from(src.split(',')[1], 'base64');
        } else {
          console.log(`[${sessionId}] Retrying CAPTCHA (Attempt ${attempts}/10)...`);
          const retry = await client.post(
            `${baseUrl}/vtop/prelogin/setup`,
            new URLSearchParams({ _csrf: csrf, flag: 'VTOP' }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${baseUrl}/vtop/open/page`,
                'Origin': baseUrl
              }
            }
          );
          setupHtml = retry.data;
          csrf = getCsrf(setupHtml) || csrf;
        }
      }
      
      if (!captchaBuffer) throw new Error('CAPTCHA not found');
      
      const captcha = await solveUsingViboot(captchaBuffer);
      console.log(`[${sessionId}] CAPTCHA solved:`, captcha);
      // --- YOUR ORIGINAL CAPTCHA LOGIC ENDS ---
      
      const loginRes = await client.post(
        `${baseUrl}/vtop/login`,
        new URLSearchParams({
          _csrf: csrf,
          username: username,
          password: password,
          captchaStr: captcha
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `${baseUrl}/vtop/open/page`,
            'Origin': baseUrl
          }
        }
      );
      
      const finalUrl = loginRes.request?.res?.responseUrl || loginRes.config.url;
      
      if (finalUrl.includes('/vtop/login/error')) {
        const pageData = typeof loginRes.data === 'string' ? loginRes.data : '';

        // Extract the exact error message from VTOP's response
        const errorMatch = pageData.match(/<strong>([^<]+)<\/strong>/);
        const vtopError = errorMatch ? errorMatch[1].trim() : '';

        // 1. Wrong username
        if (vtopError.includes('Invalid Credentials')) {
            return { success: false, error: 'Invalid Credentials' };
        }

        // 2. Correct username, wrong password
        if (vtopError.includes('Invalid LoginId/Password')) {
            return { success: false, error: 'Invalid LoginId/Password' };
        }

        // 3. Too many failed attempts on VTOP's side
        if (vtopError.includes('Maximum Fail Attempts Reached')) {
            return { success: false, error: 'Maximum Fail Attempts Reached. Use Forgot Password' };
        }

        // 4. If none matched, it's likely a wrong CAPTCHA — retry
        console.log(`[${sessionId}] CAPTCHA likely wrong. Attempt ${captchaAttempt}/${MAX_CAPTCHA_ATTEMPTS}`);
        
        if (captchaAttempt < MAX_CAPTCHA_ATTEMPTS) {
             continue; 
        } else {
             return { success: false, error: 'Max CAPTCHA Attempts Reached' };
        }
      }
      
      if (finalUrl.includes('/vtop/content') || finalUrl.includes('/vtop/student')) {
          // Success! Immediately fetch content to warm up the session
          // We don't return here yet, we fetch auth data first
          
          /* Optimization: Reuse the loginRes data if it's already the dashboard logic, 
             otherwise fetch just once */
          
          const dashboardRes = await client.get(`${baseUrl}/vtop/content`);
          sessionData.csrf = getCsrfFast(dashboardRes.data); // Use fast regex
          sessionData.authID = dashboardRes.data.match(/\b\d{2}[A-Z]{3}\d{4}\b/)?.[0];

          return { success: true };
      }
      
    } catch (error) {
      console.error(`[${sessionId}] Login error:`, error.message);
      // Removed sleep here
    }
  }
  
  return { success: false, error: 'Login Timeout' };
}

async function getAuthData(sessionId) {
  const sessionData = getSessionClient(sessionId);
  
  if (sessionData.csrf && sessionData.authID) {
    return { csrfToken: sessionData.csrf, authorizedID: sessionData.authID };
  }
  
  const baseUrl = getBaseUrl(sessionData.campus);
  const res = await sessionData.client.get(`${baseUrl}/vtop/content`);
  
  // Use Fast Regex here too
  sessionData.csrf = getCsrfFast(res.data);
  sessionData.authID = res.data.match(/\b\d{2}[A-Z]{3}\d{4}\b/)?.[0];
  
  return { csrfToken: sessionData.csrf, authorizedID: sessionData.authID };
}

async function makeAuthenticatedRequest(url, payload, sessionId, headers = {}) {
  const { csrfToken, authorizedID } = await getAuthData(sessionId);
  const sessionData = getSessionClient(sessionId);
  
  return await sessionData.client.post(url, payload, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      ...headers
    }
  });
}

function getClient(sessionId) {
  return getSessionClient(sessionId).client;
}

function getCampus(sessionId) {
  return getSessionClient(sessionId).campus || 'vellore';
}

module.exports = {
  loginToVTOP,
  getAuthData,
  makeAuthenticatedRequest,
  getClient,
  destroySession,
  getBaseUrl,
  getCampus
};

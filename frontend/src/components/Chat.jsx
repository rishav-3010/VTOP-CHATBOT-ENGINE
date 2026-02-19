import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { 
    Sun, Moon, Send, Loader2, GraduationCap, 
    Calendar, BarChart3, BookOpen, CalendarCheck, User 
} from './Icons';

// Gemini Spinner Component
const GeminiSpinner = () => (
    <div className="gemini-spinner">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="url(#grad1)" style={{zIndex: 10}}>
            <defs>
                <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{stopColor:"#4285f4", stopOpacity:1}} />
                    <stop offset="100%" style={{stopColor:"#d96570", stopOpacity:1}} />
                </linearGradient>
            </defs>
            <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" />
        </svg>
    </div>
);

// Thinking Indicator Component
const ThinkingIndicator = () => {
    const [text, setText] = useState("Thinking...");
    
    useEffect(() => {
        const thoughts = [
            "Thinking...",
            "Analyzing query...", 
            "Checking VTOP data...",
            "Formulating response..."
        ];
        let index = 0;
        const interval = setInterval(() => {
            index = (index + 1) % thoughts.length;
            setText(thoughts[index]);
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex items-center space-x-3 p-1">
            <GeminiSpinner />
            <span className="text-sm thinking-text">{text}</span>
        </div>
    );
};

// Suggestion Configuration
const SUGGESTION_CONFIG = {
    categories: {
        academic: { name: 'Academic', icon: GraduationCap },
        schedule: { name: 'Schedule', icon: Calendar },
        tasks: { name: 'Tasks', icon: BookOpen },
        leave: { name: 'Leave', icon: CalendarCheck },
        admin: { name: 'Admin', icon: BarChart3 },
        faculty: { name: 'Faculty', icon: User }
    },
    
    suggestions: {
        cgpa: { text: "What's my CGPA?", category: 'academic', triggers: ['start', 'grades', 'gradehistory'] },
        marks: { text: "Show my marks", category: 'academic', triggers: ['start', 'cgpa', 'attendance'] },
        grades: { text: "Show semester grades", category: 'academic', triggers: ['cgpa', 'marks', 'gradehistory'] },
        gradeHistory: { text: "Complete academic history", category: 'academic', triggers: ['cgpa', 'grades'] },
        attendance: { text: "Show my attendance", category: 'schedule', triggers: ['start', 'marks', 'timetable'] },
        timetable: { text: "Show my timetable", category: 'schedule', triggers: ['attendance', 'examschedule'] },
        timetableToday: { text: "What classes do I have today?", category: 'schedule', triggers: ['timetable', 'start'] },
        examSchedule: { text: "When are my exams?", category: 'schedule', triggers: ['marks', 'calendar', 'assignments'] },
        academicCalendar: { text: "Show academic calendar", category: 'schedule', triggers: ['examschedule', 'timetable'] },
        assignments: { text: "Show my assignments", category: 'tasks', triggers: ['start', 'marks', 'attendance'] },
        leaveHistory: { text: "Show my leave history", category: 'leave', triggers: ['leavestatus', 'attendance'] },
        leaveStatus: { text: "Check pending leave status", category: 'leave', triggers: ['leavehistory'] },
        paymentHistory: { text: "Show fee payment history", category: 'admin', triggers: ['start', 'proctordetails'] },
        proctorDetails: { text: "Who is my proctor?", category: 'admin', triggers: ['facultyinfo', 'start'] },
        semesterReport: { text: "Give me a complete semester report", category: 'academic', triggers: ['start', 'cgpa', 'marks'] },
        overview: { text: "Quick academic overview", category: 'academic', triggers: ['start'] }
    },
    
    flows: {
        'cgpa': ['gradeHistory', 'marks', 'grades', 'semesterReport'],
        'marks': ['attendance', 'examSchedule'],
        'attendance': ['timetable', 'marks', 'leaveHistory'],
        'assignments': ['examSchedule', 'marks'],
        'timetable': ['timetableToday', 'academicCalendar', 'attendance'],
        'examschedule': ['academicCalendar', 'marks', 'timetable'],
        'grades': ['gradeHistory', 'cgpa', 'marks'],
        'gradehistory': ['cgpa', 'grades'],
        'leavehistory': ['leaveStatus', 'attendance'],
        'paymenthistory': ['proctorDetails', 'cgpa'],
        'proctordetails': ['paymentHistory'],
        'general': ['cgpa', 'attendance', 'marks', 'assignments'],
        'default': ['semesterReport', 'attendance', 'assignments', 'timetableToday']
    }
};

const Chat = () => {
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isDemo, setIsDemo] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [isValidating, setIsValidating] = useState(true);
    const [darkMode, setDarkMode] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('darkMode') === 'true' || 
                   window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return false;
    });
    const messagesEndRef = useRef(null);
    const navigate = useNavigate();

    // Apply dark mode to document
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('darkMode', darkMode);
    }, [darkMode]);

    // Validate session on mount
    useEffect(() => {
        const validateSession = async () => {
            const sid = localStorage.getItem('sessionId');
            
            if (!sid) {
                navigate('/');
                return;
            }

            try {
                const response = await fetch('/api/session/validate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: sid })
                });
                const result = await response.json();
                
                if (!result.valid) {
                    navigate('/');
                    return;
                }

                setSessionId(sid);
                setIsDemo(result.isDemo || false);
                setIsValidating(false);
                
                setMessages([{
                    id: Date.now(),
                    type: 'system',
                    content: result.isDemo ? 
                        '✨ Connected to VTOP using demo credentials! Ask me about CGPA, attendance, marks, or assignments, and more.' :
                        '✨ Successfully connected to VTOP! You can now ask me about your CGPA, attendance, marks, timetable, and more.',
                    timestamp: new Date()
                }]);
            } catch (error) {
                console.error('Session validation error:', error);
                navigate('/');
            }
        };

        validateSession();
    }, [navigate]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleLogout = async () => {
        try {
            await fetch('/api/logout', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
        } catch (error) {
            console.error('Logout error:', error);
        }
        
        localStorage.removeItem('sessionId');
        navigate('/');
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim() || isLoading) return;

        const userMessage = {
            id: Date.now(),
            type: 'user',
            content: inputValue,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        const currentInput = inputValue;
        setInputValue('');
        setIsLoading(true);

        const loadingMessage = {
            id: Date.now() + 1,
            type: 'bot',
            content: '',
            timestamp: new Date(),
            loading: true
        };
        setMessages(prev => [...prev, loadingMessage]);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: currentInput, sessionId })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let botMessageId = Date.now() + 2;
            
            let streamBuffer = "";
            let displayedText = "";
            let headerBuffer = ""; 
            let isHeaderFound = false;
            let receivedData = null;
            let isStreamComplete = false;

            setMessages(prev => {
                const filtered = prev.filter(msg => !msg.loading);
                return [...filtered, {
                    id: botMessageId,
                    type: 'bot',
                    content: '',
                    timestamp: new Date()
                }];
            });

            const typingInterval = setInterval(() => {
                if (displayedText.length < streamBuffer.length) {
                    const backlog = streamBuffer.length - displayedText.length;
                    let charsToAdd = 1;
                    
                    if (backlog > 200) charsToAdd = 10;
                    else if (backlog > 100) charsToAdd = 5;
                    else if (backlog > 30) charsToAdd = 3;
                    else if (backlog > 10) charsToAdd = 2;
                    
                    displayedText += streamBuffer.substring(displayedText.length, displayedText.length + charsToAdd);
                    
                    setMessages(prev => prev.map(msg => 
                        msg.id === botMessageId 
                            ? { ...msg, content: displayedText, data: receivedData } 
                            : msg
                    ));
                } else if (isStreamComplete) {
                    clearInterval(typingInterval);
                }
            }, 20);

            const startMarker = '{"type":"DATA"';

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    isStreamComplete = true;
                    if (!isHeaderFound && headerBuffer.length > 0) {
                        streamBuffer += headerBuffer;
                    }
                    break;
                }

                const text = decoder.decode(value, { stream: true });
                
                if (!isHeaderFound) {
                    headerBuffer += text;
                    
                    if (headerBuffer.length >= startMarker.length && !headerBuffer.startsWith(startMarker)) {
                        streamBuffer += headerBuffer;
                        headerBuffer = "";
                        isHeaderFound = true;
                        continue;
                    }

                    const delimiterIndex = headerBuffer.indexOf('\n\n');
                    
                    if (delimiterIndex !== -1) {
                        const potentialJson = headerBuffer.substring(0, delimiterIndex);
                        const remaining = headerBuffer.substring(delimiterIndex + 2);
                        
                        if (potentialJson.startsWith(startMarker)) {
                            try {
                                const dataPart = JSON.parse(potentialJson);
                                receivedData = dataPart.payload;
                                streamBuffer += remaining;
                                isHeaderFound = true;
                            } catch (e) {
                                streamBuffer += headerBuffer;
                                isHeaderFound = true;
                            }
                        } else {
                            streamBuffer += headerBuffer;
                            isHeaderFound = true;
                        }
                        headerBuffer = "";
                    }
                } else {
                    streamBuffer += text;
                }
            }

        } catch (error) {
            setMessages(prev => {
                const filteredMessages = prev.filter(msg => !msg.loading);
                return [...filteredMessages, {
                    id: Date.now() + 2,
                    type: 'bot',
                    content: '❌ Sorry, I encountered an error processing your request. Please try again.',
                    timestamp: new Date()
                }];
            });
        }

        setIsLoading(false);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleSuggestionClick = (query) => {
        if (isLoading) return;
        setInputValue(query);
    };

    const formatMessage = (message) => {
        const htmlContent = marked.parse(message.content || '');
        const cleanHTML = DOMPurify.sanitize(htmlContent, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'blockquote', 'hr', 'span', 'div'],
            ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
            ALLOW_DATA_ATTR: false,
            ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
        });
        return (
            <div 
                className="markdown-content text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: cleanHTML }}
            />
        );
    };

    const getDynamicSuggestions = () => {
        const config = SUGGESTION_CONFIG;
        
        if (messages.length <= 1) {
            return [
                { text: "What's my CGPA?", icon: GraduationCap },
                { text: "Show my attendance", icon: Calendar },
                { text: "Get my marks", icon: BarChart3 },
                { text: "Show my assignments", icon: BookOpen }
            ];
        }

        const lastBotMessage = [...messages].reverse().find(m => m.type === 'bot' && !m.loading);
        if (!lastBotMessage) return [];

        const content = lastBotMessage.content.toLowerCase();
        
        let detectedIntent = 'default';
        
        const intentPatterns = {
            'cgpa': /cgpa|cumulative.*grade|overall.*gpa/i,
            'marks': /marks|score|cat-?1|cat-?2|fat|assessment|weightage/i,
            'attendance': /attendance|attended|classes.*missed|debarment/i,
            'assignments': /assignment|deadline|digital.*assessment|da.*due/i,
            'timetable': /timetable|schedule|monday|tuesday|wednesday|thursday|friday|class.*timing/i,
            'examschedule': /exam.*schedule|exam.*date|venue|seat.*no/i,
            'grades': /semester.*grade|gpa.*this.*semester|course.*grade/i,
            'gradehistory': /grade.*history|academic.*history|curriculum.*progress|credits.*earned/i,
            'leavehistory': /leave.*history|hostel.*leave|leave.*taken/i,
            'paymenthistory': /payment|fee.*receipt|invoice|transaction/i,
            'proctordetails': /proctor|faculty.*advisor|cabin.*number/i,
        };

        for (const [intent, pattern] of Object.entries(intentPatterns)) {
            if (pattern.test(content)) {
                detectedIntent = intent;
                break;
            }
        }

        const flowSuggestions = config.flows[detectedIntent] || config.flows['default'];
        
        const suggestions = flowSuggestions.slice(0, 4).map(key => {
            const suggestion = config.suggestions[key];
            if (!suggestion) return null;
            
            const category = config.categories[suggestion.category];
            return {
                text: suggestion.text,
                icon: category?.icon || GraduationCap
            };
        }).filter(Boolean);

        if (suggestions.length < 3) {
            const extras = [
                { text: "Show my timetable", icon: Calendar },
                { text: "Check exam schedule", icon: CalendarCheck },
                { text: "Academic calendar", icon: BookOpen }
            ];
            suggestions.push(...extras.slice(0, 3 - suggestions.length));
        }

        return suggestions;
    };

    // Show loading while validating session
    if (isValidating) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
                <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-vit-blue to-blue-600 rounded-2xl flex items-center justify-center animate-pulse">
                        <span className="text-3xl">🎓</span>
                    </div>
                    <div className="space-y-2">
                        <div className={`h-4 w-32 mx-auto rounded ${darkMode ? 'bg-slate-700' : 'bg-gray-200'} animate-pulse`}></div>
                        <div className={`h-3 w-24 mx-auto rounded ${darkMode ? 'bg-slate-700' : 'bg-gray-200'} animate-pulse`}></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen ${darkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
            {/* Header */}
            <div className="vit-header sticky top-0 z-10 shadow-lg">
                <div className="max-w-4xl mx-auto px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
                                <span className="text-xl">🎓</span>
                            </div>
                            <div>
                                <h1 className="text-lg font-semibold text-white">VTOP Assistant</h1>
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                                    <span className="text-xs text-blue-200">
                                        {isDemo ? 'Demo Mode' : 'Connected to VTOP'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={() => setDarkMode(!darkMode)}
                                className="p-2 rounded-lg transition-colors bg-white/10 text-white hover:bg-white/20"
                                title={darkMode ? 'Light mode' : 'Dark mode'}
                            >
                                {darkMode ? <Sun /> : <Moon />}
                            </button>
                            <button
                                onClick={handleLogout}
                                className="text-sm px-3 py-1.5 rounded-lg border border-white/30 text-white hover:bg-white/10 transition-colors"
                            >
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Chat Container */}
            <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-72px)]">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((message, index) => (
                        <div 
                            key={message.id}
                            className={`flex message-animate ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                            style={{ animationDelay: `${index * 0.05}s` }}
                        >
                            <div className={`flex items-start space-x-3 max-w-3xl ${
                                message.type === 'user' ? 'flex-row-reverse space-x-reverse' : ''
                            }`}>
                                {/* Avatar */}
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm ${
                                    message.type === 'user' 
                                        ? 'bg-gradient-to-br from-vit-blue to-blue-700' 
                                        : message.type === 'system' 
                                            ? 'bg-gradient-to-br from-vit-blue to-blue-800' 
                                            : 'bg-gradient-to-br from-indigo-500 to-blue-600'
                                }`}>
                                    {message.type === 'user' ? <span className="text-sm">👤</span> : 
                                     message.type === 'system' ? <span className="text-sm">🎓</span> : 
                                     <span className="text-sm">✨</span>}
                                </div>
                                {/* Message Bubble */}
                                <div className={`rounded-2xl px-4 py-3 ${
                                    message.type === 'user' 
                                        ? 'bg-gradient-to-br from-vit-blue to-blue-700 text-white shadow-md' 
                                        : message.type === 'system' 
                                            ? darkMode 
                                                ? 'bg-slate-800 text-slate-200 border border-slate-700' 
                                                : 'bg-blue-50 text-gray-800 border border-blue-100'
                                            : darkMode 
                                                ? 'bg-slate-800 text-slate-200 border border-slate-700 shadow-lg' 
                                                : 'bg-white text-gray-800 shadow-md border border-gray-100'
                                }`}>
                                    {(message.loading || (!message.content && !message.data && message.type === 'bot')) ? 
                                        <ThinkingIndicator /> : 
                                        formatMessage(message)}
                                    <div className={`text-xs mt-2 ${
                                        message.type === 'user' ? 'text-blue-200' : darkMode ? 'text-slate-500' : 'text-gray-400'
                                    }`}>
                                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Suggestions */}
                {!isLoading && (
                    <div className="px-4 py-2">
                        <div className="flex flex-wrap gap-2 justify-center">
                            {getDynamicSuggestions().map((query, index) => {
                                const IconComponent = query.icon;
                                return (
                                    <button
                                        key={index}
                                        onClick={() => handleSuggestionClick(query.text)}
                                        disabled={isLoading}
                                        className={`suggestion-button flex items-center space-x-2 px-3 py-2 rounded-full border text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 ${
                                            darkMode 
                                                ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:border-slate-600' 
                                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
                                        }`}
                                    >
                                        <IconComponent />
                                        <span>{query.text}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Input Area */}
                <div className={`p-3 mx-2 mb-2 rounded-2xl backdrop-blur-md border shadow-lg ${
                    darkMode 
                        ? 'bg-slate-800/90 border-slate-700' 
                        : 'bg-white/90 border-gray-100'
                }`}>
                    <div className="flex items-center space-x-3">
                        <div className="flex-1 relative">
                            <textarea
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder={isDemo ? 
                                    "Ask about CGPA, attendance, marks, assignments..." : 
                                    "Ask about your CGPA, attendance, marks, timetable..."}
                                disabled={isLoading}
                                className={`w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed resize-none transition-colors ${
                                    darkMode 
                                        ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400 disabled:bg-slate-600' 
                                        : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 disabled:bg-gray-100'
                                } border`}
                                rows="1"
                                style={{ minHeight: '48px', maxHeight: '120px' }}
                            />
                        </div>
                        <button
                            onClick={handleSendMessage}
                            disabled={!inputValue.trim() || isLoading}
                            className="w-12 h-12 bg-gradient-to-br from-vit-blue to-blue-700 text-white rounded-xl flex items-center justify-center hover:from-blue-800 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg hover:scale-105"
                        >
                            {isLoading ? <Loader2 /> : <Send />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Chat;

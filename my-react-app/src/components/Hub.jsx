import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    GraduationCap, Calendar, BarChart3, BookOpen, CalendarCheck,
    Clock, History, Eye, Award, CreditCard, User, BookText, Users,
    LogOut, Loader2, Copy, RefreshCw, AlertCircle
} from './Icons';

const Hub = () => {
    const [selectedFunction, setSelectedFunction] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [facultySearch, setFacultySearch] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const sid = localStorage.getItem('sessionId');
        if (!sid) {
            navigate('/');
            return;
        }
        setSessionId(sid);
    }, [navigate]);

    const functions = [
        { id: 'cgpa', name: 'CGPA & Credits', icon: GraduationCap, color: 'bg-blue-500' },
        { id: 'attendance', name: 'Attendance', icon: Calendar, color: 'bg-green-500' },
        { id: 'marks', name: 'Marks', icon: BarChart3, color: 'bg-purple-500' },
        { id: 'assignments', name: 'Assignments', icon: BookOpen, color: 'bg-orange-500' },
        { id: 'examSchedule', name: 'Exam Schedule', icon: CalendarCheck, color: 'bg-red-500' },
        { id: 'timetable', name: 'Timetable', icon: Clock, color: 'bg-indigo-500' },
        { id: 'leaveHistory', name: 'Leave History', icon: History, color: 'bg-teal-500' },
        { id: 'leaveStatus', name: 'Leave Status', icon: Eye, color: 'bg-cyan-500' },
        { id: 'grades', name: 'Grades', icon: Award, color: 'bg-yellow-500' },
        { id: 'paymentHistory', name: 'Payment History', icon: CreditCard, color: 'bg-pink-500' },
        { id: 'proctorDetails', name: 'Proctor Details', icon: User, color: 'bg-slate-500' },
        { id: 'gradeHistory', name: 'Grade History', icon: BookText, color: 'bg-violet-500' },
        { id: 'counsellingRank', name: 'Counselling Rank', icon: Award, color: 'bg-amber-500' },
        { id: 'facultyInfo', name: 'Faculty Search', icon: Users, color: 'bg-emerald-500', interactive: true },
        { id: 'academicCalendar', name: 'Academic Calendar', icon: Calendar, color: 'bg-rose-500' }
    ];

    const fetchData = async (functionId, params = {}) => {
        setLoading(true);
        setError(null);
        
        try {
            const response = await fetch('/api/direct-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    functionId,
                    sessionId,
                    params
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                setData(result.data);
                setLastUpdated(new Date());
            } else {
                setError(result.error || 'Failed to fetch data');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleFunctionClick = (func) => {
        setSelectedFunction(func.id);
        setError(null);
        setData(null);
        setFacultySearch('');
        
        if (func.id !== 'facultyInfo') {
            fetchData(func.id);
        }
    };

    const handleFacultySearch = () => {
        if (facultySearch.length < 3) {
            setError('Please enter at least 3 characters');
            return;
        }
        fetchData('facultyInfo', { facultyName: facultySearch });
    };

    const handleLogout = async () => {
        try {
            await fetch('/api/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
            localStorage.removeItem('sessionId');
            navigate('/');
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert('Copied to clipboard!');
    };

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                        <Loader2 className="w-12 h-12 mx-auto text-blue-500" />
                        <p className="text-gray-600 mt-4">Loading data...</p>
                    </div>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center bg-red-50 p-6 rounded-lg border border-red-200">
                        <AlertCircle className="mx-auto mb-4 text-red-600" />
                        <p className="text-red-600 font-semibold mb-2">Error</p>
                        <p className="text-gray-700 mb-4">{error}</p>
                        <button
                            onClick={() => selectedFunction && handleFunctionClick(functions.find(f => f.id === selectedFunction))}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        if (!selectedFunction) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                        <GraduationCap style={{ width: '64px', height: '64px', margin: '0 auto 16px', color: '#9ca3af' }} />
                        <h2 className="text-2xl font-bold text-gray-700 mb-2">Welcome to VTOP Hub</h2>
                        <p className="text-gray-600">Select a function from the sidebar to view your data instantly</p>
                    </div>
                </div>
            );
        }

        if (selectedFunction === 'facultyInfo') {
            if (!data && !loading && !error) {
                return (
                    <div className="max-w-2xl mx-auto mt-20">
                        <div className="bg-white p-8 rounded-lg shadow-lg border border-gray-200">
                            <h2 className="text-2xl font-bold text-gray-900 mb-6">🔍 Faculty Search</h2>
                            <p className="text-gray-600 mb-4">Enter the faculty member's name (at least 3 characters)</p>
                            
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    value={facultySearch}
                                    onChange={(e) => setFacultySearch(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleFacultySearch()}
                                    placeholder="e.g., Yokesh, Rajesh Kumar, etc."
                                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <button
                                    onClick={handleFacultySearch}
                                    disabled={facultySearch.length < 3}
                                    className="px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                                >
                                    Search
                                </button>
                            </div>
                            
                            {facultySearch.length > 0 && facultySearch.length < 3 && (
                                <p className="text-amber-600 text-sm mt-2">⚠️ Please enter at least 3 characters</p>
                            )}
                        </div>
                    </div>
                );
            }

            if (data?.requiresSelection && data?.faculties) {
                return (
                    <div className="space-y-4">
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-6">
                            <p className="text-blue-700 font-medium">{data.message}</p>
                        </div>
                        
                        {data.faculties.map((faculty) => (
                            <div 
                                key={faculty.empId} 
                                className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200"
                            >
                                <div className="p-5">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex-1">
                                            <h3 className="font-bold text-lg text-gray-900 mb-1">{faculty.name}</h3>
                                            <p className="text-sm text-gray-600 mb-1">{faculty.designation}</p>
                                            <p className="text-sm text-blue-600">{faculty.school}</p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const response = await fetch('/api/faculty/select', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ empId: faculty.empId, sessionId })
                                                    });
                                                    const result = await response.json();
                                                    if (result.success) {
                                                        setData({
                                                            ...faculty,
                                                            details: result.data.details,
                                                            openHours: result.data.openHours
                                                        });
                                                    }
                                                } catch (error) {
                                                    console.error('Error fetching faculty details:', error);
                                                    setError('Failed to fetch faculty details');
                                                }
                                            }}
                                            className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors text-sm font-semibold"
                                        >
                                            View Details
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                );
            }

            if (data?.details) {
                return (
                    <div className="max-w-2xl mx-auto mt-10">
                        <div className="bg-white p-6 rounded-lg shadow-lg border border-gray-200">
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">{data.name}</h2>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                <div>
                                    <p className="text-xs text-gray-600">Designation</p>
                                    <p className="font-semibold text-gray-900">{data.designation}</p>
                                </div>
                                {data.details['Name of Department'] && (
                                    <div>
                                        <p className="text-xs text-gray-600">Department</p>
                                        <p className="font-semibold text-gray-900">{data.details['Name of Department']}</p>
                                    </div>
                                )}
                                {data.details.School && (
                                    <div>
                                        <p className="text-xs text-gray-600">School</p>
                                        <p className="font-semibold text-gray-900">{data.details.School}</p>
                                    </div>
                                )}
                                {data.details['E-Mail Id'] && (
                                    <div>
                                        <p className="text-xs text-gray-600">📧 Email</p>
                                        <p className="font-semibold text-blue-600 text-sm">{data.details['E-Mail Id']}</p>
                                    </div>
                                )}
                                {data.details['Cabin Number'] && (
                                    <div>
                                        <p className="text-xs text-gray-600">🚪 Cabin Number</p>
                                        <p className="font-semibold text-gray-900">{data.details['Cabin Number']}</p>
                                    </div>
                                )}
                            </div>

                            {data.openHours?.length > 0 && (
                                <div>
                                    <p className="text-sm font-semibold text-gray-700 mb-3">🕐 Open Hours</p>
                                    <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                                        {data.openHours.map((hour, idx) => (
                                            <div key={idx} className="flex justify-between text-sm">
                                                <span className="font-medium text-gray-700">{hour.day}</span>
                                                <span className="text-gray-600">{hour.timing}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            }
            return null;
        }
        
        if (!data) return null;

        return renderFormattedData();
    };

    const renderFormattedData = () => {
        if (!data) return null;

        // CGPA Credits Display
        if (selectedFunction === 'cgpa') {
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(data).map(([key, value]) => (
                        <div key={key} className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                            <p className="text-sm text-gray-600 mb-1">{key}</p>
                            <p className="text-3xl font-bold text-gray-900">{value}</p>
                        </div>
                    ))}
                </div>
            );
        }

        // Attendance Display
        if (selectedFunction === 'attendance') {
            return (
                <div className="space-y-4">
                    {data.map((course, idx) => (
                        <div 
                            key={idx} 
                            className={`bg-white p-6 rounded-lg shadow-md border-l-4 ${
                                course.alertStatus === 'danger' ? 'border-red-500' : 'border-green-500'
                            }`}
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex-1">
                                    <h3 className="font-bold text-lg text-gray-900 mb-1">
                                        {course.courseDetail.split(' - ')[1]}
                                    </h3>
                                    <p className="text-sm text-gray-600">{course.courseDetail.split(' - ')[0]}</p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                                    course.alertStatus === 'danger' 
                                        ? 'bg-red-100 text-red-700' 
                                        : 'bg-green-100 text-green-700'
                                }`}>
                                    {course.attendancePercentage}
                                </span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <p className="text-sm text-gray-600">Classes Attended</p>
                                    <p className="text-xl font-semibold">{course.attendedClasses} / {course.totalClasses}</p>
                                </div>
                                {course.isLab && (
                                    <div>
                                        <p className="text-sm text-gray-600">Type</p>
                                        <span className="inline-block px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-semibold">LAB</span>
                                    </div>
                                )}
                            </div>

                            <div className={`p-3 rounded ${
                                course.alertStatus === 'danger' ? 'bg-red-50' : 'bg-green-50'
                            }`}>
                                <p className={`text-sm font-medium ${
                                    course.alertStatus === 'danger' ? 'text-red-700' : 'text-green-700'
                                }`}>
                                    {course.alertMessage}
                                </p>
                                {course.debarStatus !== '-' && (
                                    <p className="text-xs text-red-600 mt-2">⚠️ Debar Status: {course.debarStatus.trim()}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // Marks Display
        if (selectedFunction === 'marks') {
            return (
                <div className="space-y-6">
                    {data.map((course, idx) => (
                        <div key={idx} className="bg-white p-6 rounded-lg shadow-md">
                            <div className="mb-4">
                                <h3 className="font-bold text-xl text-gray-900 mb-1">{course.courseTitle}</h3>
                                <div className="flex gap-4 text-sm text-gray-600">
                                    <span>📚 {course.courseCode}</span>
                                    <span>👨‍🏫 {course.faculty}</span>
                                    <span>🕐 {course.slot}</span>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b-2 border-gray-200">
                                            <th className="text-left py-2 px-3 text-sm font-semibold text-gray-700">Assessment</th>
                                            <th className="text-right py-2 px-3 text-sm font-semibold text-gray-700">Scored</th>
                                            <th className="text-right py-2 px-3 text-sm font-semibold text-gray-700">Max</th>
                                            <th className="text-right py-2 px-3 text-sm font-semibold text-gray-700">Weightage</th>
                                            <th className="text-right py-2 px-3 text-sm font-semibold text-gray-700">%</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {course.marks?.map((mark, markIdx) => (
                                            <tr 
                                                key={markIdx} 
                                                className={`border-b border-gray-100 ${
                                                    mark.isTotal ? 'bg-blue-50 font-semibold' : ''
                                                }`}
                                            >
                                                <td className="py-3 px-3 text-sm">{mark.title}</td>
                                                <td className="py-3 px-3 text-sm text-right">{mark.scored}</td>
                                                <td className="py-3 px-3 text-sm text-right">{mark.max}</td>
                                                <td className="py-3 px-3 text-sm text-right font-medium text-blue-600">{mark.weightage}</td>
                                                <td className="py-3 px-3 text-sm text-right text-gray-600">{mark.percent}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // Assignments Display
        if (selectedFunction === 'assignments') {
            const subjects = data.subjects || [];
            return (
                <div className="space-y-6">
                    {subjects.map((subject, idx) => (
                        <div key={idx} className="bg-white p-6 rounded-lg shadow-md">
                            <div className="mb-4">
                                <h3 className="font-bold text-xl text-gray-900 mb-1">{subject.courseTitle}</h3>
                                <p className="text-sm text-gray-600">{subject.courseCode}</p>
                            </div>

                            <div className="space-y-3">
                                {subject.assignments?.map((assignment, assIdx) => {
                                    const isOverdue = assignment.daysLeft < 0;
                                    const isDueSoon = assignment.daysLeft >= 0 && assignment.daysLeft <= 3;
                                    
                                    return (
                                        <div 
                                            key={assIdx} 
                                            className={`p-4 rounded-lg border-l-4 ${
                                                isOverdue ? 'bg-red-50 border-red-500' :
                                                isDueSoon ? 'bg-yellow-50 border-yellow-500' :
                                                'bg-green-50 border-green-500'
                                            }`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1">
                                                    <h4 className="font-semibold text-gray-900 mb-1">{assignment.title}</h4>
                                                    <p className="text-sm text-gray-600">Due: {assignment.dueDate}</p>
                                                </div>
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                                    isOverdue ? 'bg-red-100 text-red-700' :
                                                    isDueSoon ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-green-100 text-green-700'
                                                }`}>
                                                    {assignment.status}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // Exam Schedule Display
        if (selectedFunction === 'examSchedule') {
            const examTypes = Object.keys(data);
            return (
                <div className="space-y-8">
                    {examTypes.map((examType) => (
                        <div key={examType}>
                            <h2 className="text-2xl font-bold mb-4 text-gray-900">{examType}</h2>
                            <div className="space-y-4">
                                {data[examType].map((exam, idx) => (
                                    <div key={idx} className="bg-white p-6 rounded-lg shadow-md border-l-4 border-indigo-500">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex-1">
                                                <h3 className="font-bold text-lg text-gray-900">{exam.courseTitle}</h3>
                                                <p className="text-sm text-gray-600">{exam.courseCode} • {exam.slot}</p>
                                            </div>
                                            <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-semibold">
                                                {exam.examDate}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                            <div>
                                                <p className="text-gray-600">Session</p>
                                                <p className="font-semibold">{exam.examSession}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-600">Reporting</p>
                                                <p className="font-semibold">{exam.reportingTime}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-600">Exam Time</p>
                                                <p className="font-semibold">{exam.examTime}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-600">Venue</p>
                                                <p className="font-semibold">{exam.venue} {exam.seatNo !== '-' && `(Seat: ${exam.seatNo})`}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // Timetable Display
        if (selectedFunction === 'timetable') {
            const schedule = data.schedule || {};
            const days = Object.keys(schedule);
            return (
                <div className="space-y-6">
                    {days.map((day) => (
                        <div key={day} className="bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-xl font-bold mb-4 text-gray-900 border-b pb-2">{day}</h3>
                            <div className="space-y-3">
                                {schedule[day].map((classItem, idx) => (
                                    <div key={idx} className="flex items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                        <div className="flex-shrink-0 w-24 text-sm font-semibold text-blue-600">
                                            {classItem.time}
                                        </div>
                                        <div className="flex-1 ml-4">
                                            <p className="font-semibold text-gray-900">{classItem.courseTitle}</p>
                                            <p className="text-sm text-gray-600">
                                                {classItem.courseCode} • {classItem.slot} • {classItem.venue} • {classItem.faculty}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // Grades Display
        if (selectedFunction === 'grades') {
            const grades = data.grades || [];
            const gpa = data.gpa || '';
            
            return (
                <div className="space-y-6">
                    {gpa && (
                        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-6 rounded-lg shadow-lg">
                            <h2 className="text-3xl font-bold">{gpa}</h2>
                        </div>
                    )}
                    
                    <div className="overflow-x-auto bg-white rounded-lg shadow-md">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Course</th>
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Type</th>
                                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Credits</th>
                                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Total</th>
                                    <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Grade</th>
                                </tr>
                            </thead>
                            <tbody>
                                {grades.map((grade, idx) => (
                                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                                        <td className="py-3 px-4">
                                            <p className="font-semibold text-gray-900">{grade.courseTitle}</p>
                                            <p className="text-sm text-gray-600">{grade.courseCode}</p>
                                        </td>
                                        <td className="py-3 px-4 text-sm text-gray-600">{grade.courseType}</td>
                                        <td className="py-3 px-4 text-center font-medium">{grade.creditsC}</td>
                                        <td className="py-3 px-4 text-center font-medium">{grade.total}</td>
                                        <td className="py-3 px-4 text-center">
                                            <span className={`px-3 py-1 rounded-full font-bold text-sm ${
                                                grade.grade === 'S' ? 'bg-purple-100 text-purple-700' :
                                                grade.grade === 'A' ? 'bg-green-100 text-green-700' :
                                                grade.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                                                grade.grade === 'C' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-red-100 text-red-700'
                                            }`}>
                                                {grade.grade}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
        }

        // Grade History Display
        if (selectedFunction === 'gradeHistory') {
            const gradeCount = data.gradeCount || {};
            const courses = data.courses || [];
            const cgpa = data.cgpa || '0.00';
            
            return (
                <div className="space-y-6">
                    <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-6 rounded-lg shadow-lg text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-2xl font-bold mb-2">📚 Complete Grade History</h2>
                                <p className="text-violet-100">CGPA: {cgpa}</p>
                            </div>
                            <a
                                href={`/api/downloads/grade-history?sessionId=${sessionId}`}
                                download
                                className="flex items-center gap-2 px-6 py-3 bg-white text-violet-600 rounded-lg hover:bg-violet-50 transition-colors font-semibold shadow-md"
                            >
                                Download PDF
                            </a>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-md">
                        <h3 className="text-lg font-bold mb-4">Grade Distribution</h3>
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                            {Object.entries(gradeCount).map(([grade, count]) => (
                                <div key={grade} className="text-center p-3 bg-gray-50 rounded-lg">
                                    <p className="text-2xl font-bold text-gray-900">{count}</p>
                                    <p className="text-sm text-gray-600">Grade {grade}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-md overflow-hidden">
                        <div className="p-4 bg-violet-50 border-b border-violet-200">
                            <h3 className="font-bold text-lg text-gray-900">📖 Course History</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left py-3 px-4 text-sm font-semibold">Course</th>
                                        <th className="text-center py-3 px-4 text-sm font-semibold">Credits</th>
                                        <th className="text-center py-3 px-4 text-sm font-semibold">Grade</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold">Exam</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {courses.slice(0, 15).map((course, idx) => (
                                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                                            <td className="py-3 px-4">
                                                <p className="font-semibold text-sm">{course.courseTitle}</p>
                                                <p className="text-xs text-gray-600">{course.courseCode}</p>
                                            </td>
                                            <td className="py-3 px-4 text-center font-medium">{course.credits}</td>
                                            <td className="py-3 px-4 text-center">
                                                <span className={`px-2 py-1 rounded-full font-bold text-xs ${
                                                    course.grade === 'S' ? 'bg-purple-100 text-purple-700' :
                                                    course.grade === 'A' ? 'bg-green-100 text-green-700' :
                                                    course.grade === 'B' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                    {course.grade}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-gray-600">{course.examMonth}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            );
        }

        // Leave Status Display
        if (selectedFunction === 'leaveStatus') {
            if (Array.isArray(data) && data.length === 0) {
                return (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-center">
                            <div className="text-6xl mb-4">✅</div>
                            <h3 className="text-xl font-bold text-gray-900 mb-2">No Leave Applications</h3>
                            <p className="text-gray-600">You have no pending or processed leave requests</p>
                        </div>
                    </div>
                );
            }
            return (
                <div className="space-y-4">
                    {data.map((leave, idx) => (
                        <div key={idx} className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className="font-bold text-lg">{leave.reason}</h3>
                                    <p className="text-sm text-gray-600">
                                        {leave.fromDate} to {leave.toDate}
                                    </p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                    leave.status === 'Approved' ? 'bg-green-100 text-green-700' :
                                    leave.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                                    'bg-yellow-100 text-yellow-700'
                                }`}>
                                    {leave.status}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // Leave History Display
        if (selectedFunction === 'leaveHistory') {
            if (!Array.isArray(data) || data.length === 0) {
                return (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-center">
                            <div className="text-6xl mb-4">📝</div>
                            <h3 className="text-xl font-bold text-gray-900 mb-2">No Leave History</h3>
                            <p className="text-gray-600">You have no past leave applications</p>
                        </div>
                    </div>
                );
            }

            return (
                <div className="space-y-4">
                    {data.map((leave, idx) => {
                        const isApproved = leave.status?.includes('APPROVED');
                        const isCancelled = leave.status?.includes('CANCELLED');
                        
                        return (
                            <div 
                                key={idx} 
                                className={`bg-white p-6 rounded-lg shadow-md border-l-4 ${
                                    isApproved ? 'border-green-500' :
                                    isCancelled ? 'border-red-500' :
                                    'border-yellow-500'
                                }`}
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex-1">
                                        <h3 className="font-bold text-lg text-gray-900 mb-1">{leave.reason}</h3>
                                        <p className="text-sm text-gray-600 mb-2">
                                            📍 {leave.place} • 🏷️ {leave.type}
                                        </p>
                                        <p className="text-sm font-medium text-gray-700">
                                            📅 {leave.from} → {leave.to}
                                        </p>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                                        isApproved ? 'bg-green-100 text-green-700' :
                                        isCancelled ? 'bg-red-100 text-red-700' :
                                        'bg-yellow-100 text-yellow-700'
                                    }`}>
                                        {isApproved ? 'APPROVED' : isCancelled ? 'CANCELLED' : 'PENDING'}
                                    </span>
                                </div>
                                
                                <div className={`mt-3 p-3 rounded text-sm ${
                                    isApproved ? 'bg-green-50 text-green-700' :
                                    isCancelled ? 'bg-red-50 text-red-700' :
                                    'bg-yellow-50 text-yellow-700'
                                }`}>
                                    {leave.status}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }

        // Default: Show raw JSON
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-bold capitalize">
                        {selectedFunction.replace(/([A-Z])/g, ' $1').trim()}
                    </h2>
                    <button
                        onClick={() => copyToClipboard(JSON.stringify(data, null, 2))}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        <Copy />
                        <span className="text-sm">Copy JSON</span>
                    </button>
                </div>
                <pre className="bg-gray-50 p-4 rounded-lg overflow-auto max-h-[70vh] text-sm border border-gray-200">
                    {JSON.stringify(data, null, 2)}
                </pre>
            </div>
        );
    };

    return (
        <div className="h-screen flex bg-gray-50">
            {/* Sidebar */}
            <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto flex flex-col">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                        <GraduationCap style={{ color: '#2563eb' }} />
                        <h1 className="font-bold text-lg">VTOP Hub</h1>
                    </div>
                    <p className="text-xs text-gray-600">⚡ Instant Data Access</p>
                </div>
                
                <div className="p-2 flex-1 overflow-y-auto">
                    {functions.map((func) => {
                        const Icon = func.icon;
                        return (
                            <button
                                key={func.id}
                                onClick={() => handleFunctionClick(func)}
                                className={`w-full flex items-center gap-3 p-3 rounded-lg mb-1 transition-colors ${
                                    selectedFunction === func.id
                                        ? 'bg-blue-50 text-blue-700 font-semibold'
                                        : 'hover:bg-gray-100 text-gray-700'
                                }`}
                            >
                                <div className={`${func.color} p-2 rounded text-white`}>
                                    <Icon />
                                </div>
                                <span className="text-sm">{func.name}</span>
                            </button>
                        );
                    })}
                </div>
                
                <div className="p-4 border-t border-gray-200">
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 p-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                        <LogOut />
                        <span className="text-sm font-semibold">Logout</span>
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-6">
                    {selectedFunction && lastUpdated && (
                        <div className="mb-4 flex items-center justify-between">
                            <p className="text-sm text-gray-600">
                                ⚡ Loaded at: {lastUpdated.toLocaleTimeString()}
                            </p>
                            <button
                                onClick={() => handleFunctionClick(functions.find(f => f.id === selectedFunction))}
                                className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                            >
                                <RefreshCw />
                                <span>Refresh</span>
                            </button>
                        </div>
                    )}
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

export default Hub;

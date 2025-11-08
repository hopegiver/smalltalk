// Data will be loaded from JSON file
let sentences = [];

// Global variables
let recognition;
let currentTranscript = '';
let currentQuizSet = [];
let currentQuestionIndex = 0;
let correctCount = 0;
let quizResults = [];
let autoNextTimer = null;
let quizMode = 'smart'; // 'smart', 'random', 'wrong'
let isRecording = false;
let shouldRestart = false;

// Load data from JSON file
async function loadData() {
    try {
        const response = await fetch('data.json');
        sentences = await response.json();
        updateStartScreenStats();
    } catch (error) {
        console.error('Failed to load data:', error);
        alert('데이터 로딩에 실패했습니다.');
    }
}

// Initialize Speech Recognition
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        document.getElementById('micWarning').style.display = 'block';
        return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isRecording = true;
        console.log('Speech recognition started');
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }

        currentTranscript = (finalTranscript + interimTranscript).trim();
        document.getElementById('transcript').textContent = currentTranscript || '당신의 답변이 여기에 표시됩니다...';
    };

    recognition.onend = () => {
        isRecording = false;
        console.log('Speech recognition ended');

        // Auto-restart if still in quiz mode and not manually stopped
        if (shouldRestart) {
            setTimeout(() => {
                try {
                    recognition.start();
                } catch (e) {
                    console.log('Failed to restart recognition');
                }
            }, 100);
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            document.getElementById('micWarning').style.display = 'block';
            shouldRestart = false;
        } else if (event.error === 'no-speech') {
            // No speech detected, will auto-restart via onend
            console.log('No speech detected, will restart');
        } else if (event.error === 'aborted') {
            // Recognition was aborted, don't restart
            shouldRestart = false;
        }
    };

    return true;
}

// Load learning progress from localStorage
function loadProgress() {
    const progress = localStorage.getItem('englishProgress');
    if (progress) {
        return JSON.parse(progress);
    }
    // Initialize progress for all sentences
    return sentences.map(s => ({
        id: s.id,
        correctCount: 0,
        wrongCount: 0,
        lastSeen: null
    }));
}

// Save progress to localStorage
function saveProgress(progress) {
    localStorage.setItem('englishProgress', JSON.stringify(progress));
}

// Load daily statistics
function loadDailyStats() {
    const stats = localStorage.getItem('dailyStats');
    if (stats) {
        return JSON.parse(stats);
    }
    return {};
}

// Save daily statistics
function saveDailyStats(stats) {
    localStorage.setItem('dailyStats', JSON.stringify(stats));
}

// Get today's date key (YYYY-MM-DD)
function getTodayKey() {
    const today = new Date();
    return today.toISOString().split('T')[0];
}

// Update daily statistics
function updateDailyStats(isCorrect) {
    const todayKey = getTodayKey();
    const stats = loadDailyStats();

    if (!stats[todayKey]) {
        stats[todayKey] = {
            total: 0,
            correct: 0
        };
    }

    stats[todayKey].total++;
    if (isCorrect) {
        stats[todayKey].correct++;
    }

    saveDailyStats(stats);
}

// Calculate streak days
function calculateStreak() {
    const stats = loadDailyStats();
    const dates = Object.keys(stats).sort().reverse();

    if (dates.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < dates.length; i++) {
        const expectedDate = new Date(today);
        expectedDate.setDate(today.getDate() - i);
        const expectedKey = expectedDate.toISOString().split('T')[0];

        if (dates[i] === expectedKey) {
            streak++;
        } else {
            break;
        }
    }

    return streak;
}

// Update stats on start screen
function updateStartScreenStats() {
    if (sentences.length === 0) return;

    const progress = loadProgress();
    const mastered = progress.filter(p => p.correctCount >= 3 && p.wrongCount === 0).length;
    const totalAttempts = progress.reduce((sum, p) => sum + p.correctCount + p.wrongCount, 0);
    const totalCorrect = progress.reduce((sum, p) => sum + p.correctCount, 0);
    const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    const wrongOnly = progress.filter(p => p.wrongCount > 0).length;
    const streak = calculateStreak();

    // Update quick stats
    document.getElementById('quickStreak').textContent = streak;
    document.getElementById('quickMastered').textContent = mastered;
    document.getElementById('quickAccuracy').textContent = accuracy + '%';

    // Update wrong count
    document.getElementById('wrongCount').textContent = `${wrongOnly}개`;

    // Enable/disable wrong answers menu item
    const wrongMenu = document.getElementById('wrongOnlyMenu');
    if (wrongMenu) {
        if (wrongOnly === 0) {
            wrongMenu.classList.add('disabled');
        } else {
            wrongMenu.classList.remove('disabled');
        }
    }
}

// Shuffle array
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Select 10 questions using spaced repetition algorithm
function selectQuestions() {
    const progress = loadProgress();
    const now = Date.now();

    if (quizMode === 'wrong') {
        // Only wrong answers
        const wrongSentences = sentences.filter(sentence => {
            const prog = progress.find(p => p.id === sentence.id);
            return prog && prog.wrongCount > 0;
        });

        if (wrongSentences.length === 0) {
            alert('틀린 문제가 없습니다!');
            return [];
        }

        const selected = wrongSentences.slice(0, Math.min(10, wrongSentences.length));
        return shuffleArray(selected);
    }

    if (quizMode === 'random') {
        // Completely random 10 questions
        return shuffleArray(sentences).slice(0, 10);
    }

    // Smart mode - spaced repetition
    const prioritized = sentences.map(sentence => {
        const prog = progress.find(p => p.id === sentence.id) || {
            correctCount: 0,
            wrongCount: 0,
            lastSeen: null
        };

        // Higher priority for wrong answers and unseen questions
        let priority = 100;

        if (prog.wrongCount > 0) {
            priority += prog.wrongCount * 50; // Wrong answers get high priority
        }

        if (prog.correctCount === 0) {
            priority += 30; // Never seen before
        } else {
            priority -= prog.correctCount * 10; // Lower priority for correct answers
        }

        // Time-based priority (seen long ago get higher priority)
        if (prog.lastSeen) {
            const daysSince = (now - prog.lastSeen) / (1000 * 60 * 60 * 24);
            priority += daysSince * 5;
        }

        return { ...sentence, priority, progress: prog };
    });

    // Sort by priority and select top 10
    prioritized.sort((a, b) => b.priority - a.priority);
    return prioritized.slice(0, 10);
}

// Start quiz with specific mode
function startQuiz(mode = 'smart') {
    if (!initSpeechRecognition()) {
        alert('음성 인식을 사용할 수 없습니다. Chrome 또는 Edge 브라우저를 사용하세요.');
        return;
    }

    quizMode = mode;
    currentQuizSet = selectQuestions();

    if (currentQuizSet.length === 0) {
        return;
    }

    currentQuestionIndex = 0;
    correctCount = 0;
    quizResults = [];

    showScreen('quizScreen');
    loadQuestion();
}

// Load current question
function loadQuestion() {
    if (currentQuestionIndex >= currentQuizSet.length) {
        showResults();
        return;
    }

    const question = currentQuizSet[currentQuestionIndex];
    document.getElementById('questionText').textContent = question.ko;
    document.getElementById('currentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
    document.getElementById('currentCorrect').textContent = correctCount;

    // Update progress bar
    const progress = ((currentQuestionIndex) / currentQuizSet.length) * 100;
    document.getElementById('progressBar').style.width = progress + '%';

    // Reset transcript and start recording
    currentTranscript = '';
    document.getElementById('transcript').textContent = '당신의 답변이 여기에 표시됩니다...';

    // Enable auto-restart
    shouldRestart = true;

    // Start recording after a short delay
    setTimeout(() => {
        try {
            if (!isRecording) {
                recognition.start();
            }
        } catch (e) {
            console.log('Recognition already started');
        }
    }, 500);
}

// Check answer
function checkAnswer() {
    // Disable auto-restart and stop recognition
    shouldRestart = false;
    try {
        recognition.stop();
    } catch (e) {
        console.log('Recognition stop error');
    }

    const question = currentQuizSet[currentQuestionIndex];
    const userAnswer = currentTranscript.toLowerCase().trim();
    const correctAnswer = question.en.toLowerCase().trim();

    // Simple similarity check
    const isCorrect = calculateSimilarity(userAnswer, correctAnswer) > 0.7;

    // Update progress
    const progress = loadProgress();
    const progIndex = progress.findIndex(p => p.id === question.id);
    if (progIndex !== -1) {
        if (isCorrect) {
            progress[progIndex].correctCount++;
        } else {
            progress[progIndex].wrongCount++;
        }
        progress[progIndex].lastSeen = Date.now();
        saveProgress(progress);
    }

    // Update daily statistics
    updateDailyStats(isCorrect);

    // Store result
    quizResults.push({
        question: question,
        userAnswer: currentTranscript,
        correct: isCorrect
    });

    if (isCorrect) {
        correctCount++;
    }

    // Show answer screen
    showAnswerScreen(question, currentTranscript, isCorrect);
}

// Calculate similarity between two strings
function calculateSimilarity(s1, s2) {
    // Normalize strings
    s1 = s1.toLowerCase().replace(/[^\w\s]/g, '');
    s2 = s2.toLowerCase().replace(/[^\w\s]/g, '');

    if (s1 === s2) return 1.0;

    // Levenshtein distance
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    const editDistance = getEditDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

function getEditDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

// Show answer screen
function showAnswerScreen(question, userAnswer, isCorrect) {
    document.getElementById('resultIcon').textContent = isCorrect ? '✓' : '✗';
    document.getElementById('resultIcon').className = 'result-icon ' + (isCorrect ? 'correct' : 'incorrect');
    document.getElementById('correctAnswer').textContent = question.en;
    document.getElementById('userAnswer').textContent = userAnswer || '(답변 없음)';

    showScreen('answerScreen');

    // Auto next after 3 seconds
    let countdown = 3;
    document.getElementById('autoNextTimer').textContent = `${countdown}초 후 자동으로 넘어갑니다...`;

    autoNextTimer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            document.getElementById('autoNextTimer').textContent = `${countdown}초 후 자동으로 넘어갑니다...`;
        } else {
            clearInterval(autoNextTimer);
            nextQuestion();
        }
    }, 1000);
}

// Next question
function nextQuestion() {
    if (autoNextTimer) {
        clearInterval(autoNextTimer);
        autoNextTimer = null;
    }

    currentQuestionIndex++;
    showScreen('quizScreen');
    loadQuestion();
}

// Show results
function showResults() {
    // Stop recognition completely
    shouldRestart = false;
    try {
        if (recognition) {
            recognition.stop();
        }
    } catch (e) {
        console.log('Recognition already stopped');
    }

    const wrongCount = quizResults.filter(r => !r.correct).length;
    const score = Math.round((correctCount / quizResults.length) * 100);

    document.getElementById('finalCorrect').textContent = correctCount;
    document.getElementById('finalWrong').textContent = wrongCount;
    document.getElementById('finalScore').textContent = score + '%';

    // Build result list
    const resultList = document.getElementById('resultList');
    resultList.innerHTML = '<h2 style="margin-bottom: 15px;">상세 결과</h2>';

    quizResults.forEach((result, index) => {
        const item = document.createElement('div');
        item.className = 'result-item ' + (result.correct ? 'correct' : 'wrong');

        let html = `
            <div style="font-weight: bold; margin-bottom: 5px;">${index + 1}. ${result.correct ? '✓' : '✗'}</div>
            <div class="korean">${result.question.ko}</div>
            <div class="english">정답: ${result.question.en}</div>
        `;

        if (!result.correct) {
            html += `<div class="your-answer">당신의 답변: ${result.userAnswer || '(답변 없음)'}</div>`;
        }

        item.innerHTML = html;
        resultList.appendChild(item);
    });

    showScreen('resultScreen');
    updateStartScreenStats();
}

// Restart quiz
function restartQuiz() {
    showScreen('startScreen');
}

// Go back to home (cancel current quiz)
function goHome() {
    // Disable auto-restart and stop recognition
    shouldRestart = false;
    try {
        if (recognition) {
            recognition.stop();
        }
    } catch (e) {
        console.log('Recognition stop error');
    }

    // Clear auto-next timer
    if (autoNextTimer) {
        clearInterval(autoNextTimer);
        autoNextTimer = null;
    }

    // Confirm before leaving if quiz is in progress
    if (confirm('진행 중인 테스트를 종료하시겠습니까?')) {
        showScreen('startScreen');
    }
}

// Show screen
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// Show statistics
function showStatistics() {
    const stats = loadDailyStats();
    const todayKey = getTodayKey();
    const todayStats = stats[todayKey] || { total: 0, correct: 0 };

    // Calculate overall stats
    const allDates = Object.keys(stats);
    const totalDays = allDates.length;
    const totalQuestions = allDates.reduce((sum, date) => sum + stats[date].total, 0);
    const streak = calculateStreak();

    // Update stats display
    document.getElementById('streakDays').textContent = `${streak}일`;
    document.getElementById('totalDays').textContent = `${totalDays}일`;
    document.getElementById('totalQuestions').textContent = `${totalQuestions}개`;

    // Today's stats
    document.getElementById('todayQuestions').textContent = todayStats.total;
    document.getElementById('todayCorrect').textContent = todayStats.correct;
    const todayAccuracy = todayStats.total > 0
        ? Math.round((todayStats.correct / todayStats.total) * 100)
        : 0;
    document.getElementById('todayAccuracy').textContent = `${todayAccuracy}%`;

    // Build weekly calendar
    buildWeeklyCalendar(stats);

    showScreen('statsScreen');
}

// Build weekly calendar
function buildWeeklyCalendar(stats) {
    const calendarGrid = document.getElementById('calendarGrid');
    calendarGrid.innerHTML = '';

    const today = new Date();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        const dayStats = stats[dateKey] || { total: 0, correct: 0 };

        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';

        if (dayStats.total > 0) {
            dayElement.classList.add('studied');
        }

        if (i === 0) {
            dayElement.classList.add('today');
        }

        const dayName = dayNames[date.getDay()];
        const dayDate = date.getDate();

        dayElement.innerHTML = `
            <div class="calendar-day-name">${dayName}</div>
            <div class="calendar-day-date">${dayDate}</div>
            ${dayStats.total > 0 ? `<div class="calendar-day-count">${dayStats.total}개</div>` : ''}
        `;

        calendarGrid.appendChild(dayElement);
    }
}

// Close statistics
function closeStatistics() {
    showScreen('startScreen');
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('ServiceWorker registered:', registration);
            })
            .catch((error) => {
                console.log('ServiceWorker registration failed:', error);
            });
    });
}

// Initialize on load
window.addEventListener('load', async () => {
    await loadData();
});

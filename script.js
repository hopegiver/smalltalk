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
let recognitionTimeout = null;
let hasSpeech = false;

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
        hasSpeech = false;
        console.log('Speech recognition started');

        // Set 30 second timeout - maximum recording time
        if (recognitionTimeout) {
            clearTimeout(recognitionTimeout);
        }
        recognitionTimeout = setTimeout(() => {
            console.log('30 seconds passed, stopping recording...');
            shouldRestart = false;
            try {
                recognition.stop();
            } catch (e) {
                console.log('Recognition stop error');
            }
        }, 30000);
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript + ' ';
                hasSpeech = true; // Speech detected
            } else {
                interimTranscript += transcript;
            }
        }

        currentTranscript = (finalTranscript + interimTranscript).trim();
        document.getElementById('transcript').textContent = currentTranscript || '당신의 답변이 여기에 표시됩니다...';

        // If we have speech, cancel the timeout (keep recording, just don't auto-submit)
        if (hasSpeech) {
            shouldRestart = false; // Don't restart after end
            if (recognitionTimeout) {
                clearTimeout(recognitionTimeout);
                recognitionTimeout = null;
            }
        }
    };

    recognition.onend = () => {
        isRecording = false;
        console.log('Speech recognition ended');

        // Clear timeout if exists
        if (recognitionTimeout) {
            clearTimeout(recognitionTimeout);
            recognitionTimeout = null;
        }

        // Don't auto-restart anymore
        shouldRestart = false;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);

        // Clear timeout on error
        if (recognitionTimeout) {
            clearTimeout(recognitionTimeout);
            recognitionTimeout = null;
        }

        if (event.error === 'not-allowed') {
            document.getElementById('micWarning').style.display = 'block';
            shouldRestart = false;
        } else if (event.error === 'no-speech') {
            console.log('No speech detected');
            shouldRestart = false;
        } else if (event.error === 'aborted') {
            shouldRestart = false;
        } else if (event.error === 'audio-capture') {
            console.log('Audio capture error');
            shouldRestart = false;
        }
    };

    return true;
}

// Load learning progress from localStorage
function loadProgress() {
    const progress = localStorage.getItem('englishProgress');
    const dataVersion = localStorage.getItem('dataVersion');
    const currentVersion = 'v5'; // Increment when data structure changes

    // Reset if version mismatch (structure changed)
    if (dataVersion !== currentVersion) {
        console.log('Data structure changed, resetting progress...');
        localStorage.removeItem('englishProgress');
        localStorage.setItem('dataVersion', currentVersion);
        return sentences.map(s => ({
            id: s.id,
            score: 0,
            attempts: 0,
            wrongCount: 0,
            lastSeen: null
        }));
    }

    if (progress) {
        return JSON.parse(progress);
    }
    // Initialize progress for all sentences
    return sentences.map(s => ({
        id: s.id,
        score: 0,
        attempts: 0,
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
    const mastered = progress.filter(p => p.score >= 30).length; // 3+ correct answers = 30+ points

    // Calculate total attempts and correct answers from score
    // Positive scores: correct answers = score/10
    // Negative scores: wrong answers = abs(score)/20, correct answers = 0
    const totalCorrect = progress.reduce((sum, p) => sum + Math.max(0, Math.floor(p.score / 10)), 0);
    const totalWrong = progress.reduce((sum, p) => sum + Math.max(0, Math.floor(Math.abs(Math.min(0, p.score)) / 20)), 0);
    const totalAttempts = totalCorrect + totalWrong;
    const accuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    const wrongOnly = progress.filter(p => p.score < 0).length;
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

// Select 10 questions using score-based algorithm
function selectQuestions() {
    const progress = loadProgress();

    if (quizMode === 'wrong') {
        // Only wrong answers (score < 0)
        const wrongSentences = sentences.filter(sentence => {
            const prog = progress.find(p => p.id === sentence.id);
            return prog && prog.score < 0;
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

    // Smart mode - score-based (lowest scores first, then least attempts)
    const scored = sentences.map(sentence => {
        const prog = progress.find(p => p.id === sentence.id) || {
            score: 0,
            attempts: 0,
            lastSeen: null
        };

        return { ...sentence, score: prog.score, attempts: prog.attempts, progress: prog };
    });

    // Sort by score (ascending), then by attempts (ascending)
    scored.sort((a, b) => {
        if (a.score !== b.score) {
            return a.score - b.score; // Lower score first
        }
        return a.attempts - b.attempts; // If same score, less attempts first
    });
    return scored.slice(0, 10);
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

    // Update quiz header based on mode
    const quizHeader = document.getElementById('quizHeader');
    if (mode === 'smart') {
        quizHeader.textContent = '🎯 스마트 학습';
    } else if (mode === 'random') {
        quizHeader.textContent = '🎲 랜덤 테스트';
    } else if (mode === 'wrong') {
        quizHeader.textContent = '❌ 틀린 문제';
    }

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
    const transcriptEl = document.getElementById('transcript');
    transcriptEl.textContent = '당신의 답변이 여기에 표시됩니다...';

    // Add click handler for re-recording
    transcriptEl.onclick = () => {
        if (!isRecording) {
            startRecording();
        }
    };
    transcriptEl.style.cursor = 'pointer';

    // Start recording after a short delay
    setTimeout(() => {
        startRecording();
    }, 500);
}

// Start recording with 10 second timeout
function startRecording() {
    currentTranscript = '';
    hasSpeech = false;
    document.getElementById('transcript').textContent = '녹음 중... 영어로 말해보세요';

    try {
        if (!isRecording) {
            recognition.start();
        }
    } catch (e) {
        console.log('Recognition already started');
    }
}

// Check answer
function checkAnswer() {
    // Clear timeout if exists
    if (recognitionTimeout) {
        clearTimeout(recognitionTimeout);
        recognitionTimeout = null;
    }

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
        progress[progIndex].attempts++; // Increment attempts count
        if (isCorrect) {
            progress[progIndex].score += 10; // Add 10 points for correct answer
        } else {
            progress[progIndex].score -= 20; // Subtract 20 points for wrong answer
            progress[progIndex].wrongCount++; // Increment wrong count
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

    // Auto next after 5 seconds
    let countdown = 5;
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
    // Clear recognition timeout
    if (recognitionTimeout) {
        clearTimeout(recognitionTimeout);
        recognitionTimeout = null;
    }

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
function showScreen(screenId, addToHistory = true) {
    // If going to start screen, clean up everything
    if (screenId === 'startScreen') {
        // Clear recognition timeout
        if (recognitionTimeout) {
            clearTimeout(recognitionTimeout);
            recognitionTimeout = null;
        }

        // Stop recognition
        shouldRestart = false;
        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                console.log('Recognition already stopped');
            }
        }

        // Clear auto-next timer
        if (autoNextTimer) {
            clearInterval(autoNextTimer);
            autoNextTimer = null;
        }

        // Reset states
        isRecording = false;
        hasSpeech = false;
    }

    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');

    // Add to browser history for back button support
    if (addToHistory) {
        history.pushState({ screen: screenId }, '', '');
    }
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
                console.log('[App] ServiceWorker registered:', registration);

                // Check for updates when app loads
                registration.update();

                // Handle updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    console.log('[App] New service worker found, installing...');

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker is ready
                            console.log('[App] New version available!');

                            // Show update notification
                            if (confirm('새로운 버전이 있습니다. 지금 업데이트하시겠습니까?')) {
                                newWorker.postMessage({ action: 'skipWaiting' });
                                window.location.reload();
                            }
                        }
                    });
                });
            })
            .catch((error) => {
                console.log('[App] ServiceWorker registration failed:', error);
            });

        // Reload page when new service worker takes control
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                console.log('[App] Controller changed, reloading page...');
                refreshing = true;
                window.location.reload();
            }
        });
    });
}

// Handle browser back button
window.addEventListener('popstate', (event) => {
    // Clear recognition timeout
    if (recognitionTimeout) {
        clearTimeout(recognitionTimeout);
        recognitionTimeout = null;
    }

    // Stop recognition and timers when navigating back
    shouldRestart = false;
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {}
    }
    if (autoNextTimer) {
        clearInterval(autoNextTimer);
        autoNextTimer = null;
    }

    // Go to the previous screen or start screen
    const screenId = event.state?.screen || 'startScreen';
    showScreen(screenId, false);
});

// Initialize on load
window.addEventListener('load', async () => {
    await loadData();
    // Set initial history state
    history.replaceState({ screen: 'startScreen' }, '', '');
});

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
let totalTestSessions = 0; // Total number of test sessions completed
let randomModeCompleteRounds = 0; // Number of complete rounds in random mode
let randomModeProgress = []; // Track which sentences have been tested in current round

// TTS (Text-to-Speech)
let speechSynthesis = window.speechSynthesis;
let currentUtterance = null;
let lastSpokenText = ''; // Store last spoken text for replay

// Function to extract English from Korean dialogue box (A or B's response)
function extractEnglishFromKorean(koText) {
    // Try to find English after "A:"
    let match = koText.match(/A:\s*([A-Za-z][^<]*)/);
    if (match && match[1]) {
        return match[1].trim();
    }

    // Try to find English after "B:"
    match = koText.match(/<br\s*\/?>\s*B:\s*([A-Za-z][^<]*)/i);
    if (match && match[1]) {
        return match[1].trim();
    }

    return '';
}

// Function to extract full English dialogue from Korean text (both A and B in order)
function extractFullDialogue(koText, enText) {
    // Split by <br> to get A and B parts
    const parts = koText.split(/<br\s*\/?>/i);
    let result = [];

    parts.forEach((part, index) => {
        // Check if this part contains Korean (한글)
        const hasKorean = /[가-힣]/.test(part);

        if (hasKorean) {
            // This part has Korean, so add the English answer here
            const prefix = index === 0 ? 'A: ' : 'B: ';
            result.push(prefix + enText);
        } else {
            // This part is already English, keep it as is with proper prefix
            const englishMatch = part.match(/[AB]:\s*(.+)/);
            if (englishMatch) {
                result.push(part.trim());
            }
        }
    });

    return result.join('\n');
}

// Function to speak English text
function speakEnglish(text) {
    // Cancel any ongoing speech
    if (currentUtterance) {
        speechSynthesis.cancel();
    }

    // Remove HTML tags and A:, B: prefixes if present
    let cleanText = text.replace(/<br\s*\/?>/gi, ' ').replace(/^[AB]:\s*/gim, '').trim();

    // Store for replay
    lastSpokenText = cleanText;

    // Create new utterance
    currentUtterance = new SpeechSynthesisUtterance(cleanText);
    currentUtterance.lang = 'en-US';
    currentUtterance.rate = 0.9; // Slightly slower for learning

    speechSynthesis.speak(currentUtterance);
}

// Function to replay last spoken text
function replayTTS() {
    if (lastSpokenText) {
        speakEnglish(lastSpokenText);
    }
}

// Function to stop TTS
function stopTTS() {
    if (speechSynthesis) {
        speechSynthesis.cancel();
    }
    currentUtterance = null;
}

// Load data from JSON file
async function loadData() {
    try {
        const response = await fetch('data.json');
        sentences = await response.json();
        
        // Load total test sessions from localStorage
        const savedSessions = localStorage.getItem('totalTestSessions');
        totalTestSessions = savedSessions ? parseInt(savedSessions, 10) : 0;
        
        // Load random mode complete rounds
        const savedRounds = localStorage.getItem('randomModeCompleteRounds');
        randomModeCompleteRounds = savedRounds ? parseInt(savedRounds, 10) : 0;
        
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

        // Update transcript for current mode
        const transcriptText = currentTranscript || '당신의 답변이 여기에 표시됩니다...';
        if (quizMode === 'smart') {
            document.getElementById('smartTranscript').textContent = transcriptText;
        } else if (quizMode === 'wrong') {
            document.getElementById('wrongTranscript').textContent = transcriptText;
        }

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
        // Random mode - show only sentences with attempts = 0
        const withAttempts = sentences.map(sentence => {
            const prog = progress.find(p => p.id === sentence.id) || {
                attempts: 0
            };
            return { ...sentence, attempts: prog.attempts };
        });

        // Get only untested sentences (attempts = 0)
        let candidates = withAttempts.filter(s => s.attempts === 0);

        // If all sentences have been tested (no attempts = 0), reset all to 0
        if (candidates.length === 0) {
            // Reset all attempts to 0 and increment round counter
            sentences.forEach(sentence => {
                const prog = progress.find(p => p.id === sentence.id);
                if (prog) {
                    prog.attempts = 0;
                }
            });
            saveProgress(progress);

            // Increment complete rounds counter
            randomModeCompleteRounds++;

            // All sentences are now candidates again
            candidates = withAttempts.map(s => ({ ...s, attempts: 0 }));
        }

        return shuffleArray(candidates).slice(0, Math.min(10, candidates.length));
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
    // For random mode, don't need speech recognition
    if (mode !== 'random') {
        if (!initSpeechRecognition()) {
            alert('음성 인식을 사용할 수 없습니다. Chrome 또는 Edge 브라우저를 사용하세요.');
            return;
        }
    }

    quizMode = mode;
    currentQuizSet = selectQuestions();

    if (currentQuizSet.length === 0) {
        return;
    }

    currentQuestionIndex = 0;
    correctCount = 0;
    quizResults = [];

    // Show appropriate screen based on mode
    if (mode === 'smart') {
        showScreen('smartQuizScreen');
    } else if (mode === 'random') {
        showScreen('randomQuizScreen');
    } else if (mode === 'wrong') {
        showScreen('wrongQuizScreen');
    }

    loadQuestion();
}

// Load current question
function loadQuestion() {
    if (currentQuestionIndex >= currentQuizSet.length) {
        showResults();
        return;
    }

    const question = currentQuizSet[currentQuestionIndex];
    const progress = ((currentQuestionIndex) / currentQuizSet.length) * 100;

    if (quizMode === 'smart') {
        document.getElementById('smartQuestionText').innerHTML = question.ko;
        document.getElementById('smartCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
        document.getElementById('smartCorrect').textContent = correctCount;
        document.getElementById('smartTotalSessions').textContent = `${totalTestSessions}회`;
        document.getElementById('smartProgressBar').style.width = progress + '%';

    } else if (quizMode === 'random') {
        const remainingCount = getRandomModeRemainingCount();

        document.getElementById('randomQuestionText').innerHTML = question.ko;
        document.getElementById('randomCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
        document.getElementById('randomCorrect').textContent = correctCount;
        document.getElementById('randomRemaining').textContent = `${remainingCount}개`;
        document.getElementById('randomProgressBar').style.width = progress + '%';

    } else if (quizMode === 'wrong') {
        document.getElementById('wrongQuestionText').innerHTML = question.ko;
        document.getElementById('wrongCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
        document.getElementById('wrongCorrect').textContent = correctCount;
        document.getElementById('wrongTotalSessions').textContent = `${totalTestSessions}회`;
        document.getElementById('wrongProgressBar').style.width = progress + '%';
    }

    // Speak the English part from the Korean dialogue box (B's response)
    const englishInQuestion = extractEnglishFromKorean(question.ko);
    if (englishInQuestion) {
        speakEnglish(englishInQuestion);
    }
}

// Start recording with 10 second timeout
function startRecording() {
    currentTranscript = '';
    hasSpeech = false;

    // Update transcript for current mode
    if (quizMode === 'smart') {
        document.getElementById('smartTranscript').textContent = '녹음 중... 영어로 말해보세요';
    } else if (quizMode === 'wrong') {
        document.getElementById('wrongTranscript').textContent = '녹음 중... 영어로 말해보세요';
    }

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
    const question = currentQuizSet[currentQuestionIndex];

    // For all modes, just show the answer without scoring yet
    // Don't update attempts here - will be done when user clicks 맞음/틀림
    const progress = loadProgress();
    const progIndex = progress.findIndex(p => p.id === question.id);
    if (progIndex !== -1) {
        progress[progIndex].lastSeen = Date.now();
        saveProgress(progress);
    }

    // Store result placeholder (will be updated when user clicks 맞음/틀림)
    quizResults.push({
        question: question,
        userAnswer: '',
        correct: true // Will be updated in markAnswer
    });

    // Show answer screen based on mode
    if (quizMode === 'random') {
        showAnswerScreenForRandom(question);
    } else if (quizMode === 'smart') {
        showAnswerScreenForSmart(question);
    } else if (quizMode === 'wrong') {
        showAnswerScreenForWrong(question);
    }
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

// Show answer screen for random mode
function showAnswerScreenForRandom(question) {
    const remainingCount = getRandomModeRemainingCount();
    const answerProgress = ((currentQuestionIndex + 1) / currentQuizSet.length) * 100;

    document.getElementById('randomCorrectAnswer').textContent = question.en;
    document.getElementById('randomAnswerCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
    document.getElementById('randomAnswerCorrect').textContent = correctCount;
    document.getElementById('randomAnswerRemaining').textContent = `${remainingCount}개`;
    document.getElementById('randomAnswerProgressBar').style.width = answerProgress + '%';

    showScreen('randomAnswerScreen');

    // Speak the English answer
    speakEnglish(question.en);
}

// Show answer screen for smart mode
function showAnswerScreenForSmart(question) {
    const answerProgress = ((currentQuestionIndex + 1) / currentQuizSet.length) * 100;

    document.getElementById('smartCorrectAnswer').textContent = question.en;
    document.getElementById('smartAnswerCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
    document.getElementById('smartAnswerCorrect').textContent = correctCount;
    document.getElementById('smartAnswerTotalSessions').textContent = `${totalTestSessions}회`;
    document.getElementById('smartAnswerProgressBar').style.width = answerProgress + '%';

    showScreen('smartAnswerScreen');

    // Speak the English answer
    speakEnglish(question.en);
}

// Show answer screen for wrong mode
function showAnswerScreenForWrong(question) {
    const answerProgress = ((currentQuestionIndex + 1) / currentQuizSet.length) * 100;

    document.getElementById('wrongCorrectAnswer').textContent = question.en;
    document.getElementById('wrongAnswerCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
    document.getElementById('wrongAnswerCorrect').textContent = correctCount;
    document.getElementById('wrongAnswerTotalSessions').textContent = `${totalTestSessions}회`;
    document.getElementById('wrongAnswerProgressBar').style.width = answerProgress + '%';

    showScreen('wrongAnswerScreen');

    // Speak the English answer
    speakEnglish(question.en);
}

// Mark answer as correct or wrong (for all modes)
function markAnswer(isCorrect) {
    const question = currentQuizSet[currentQuestionIndex];
    const progress = loadProgress();
    const progIndex = progress.findIndex(p => p.id === question.id);

    if (progIndex !== -1) {
        // Always increment attempts when answered
        progress[progIndex].attempts++;

        if (isCorrect) {
            // Correct answer - increase score
            progress[progIndex].score += 10;
            correctCount++;
        } else {
            // Wrong answer - decrease score and mark as wrong
            progress[progIndex].score -= 20;
            progress[progIndex].wrongCount++;
        }
        saveProgress(progress);
    }

    // Update daily statistics
    updateDailyStats(isCorrect);

    // Update the result
    quizResults[quizResults.length - 1].correct = isCorrect;

    // Move to next question
    currentQuestionIndex++;

    // Show appropriate quiz screen based on mode
    if (quizMode === 'smart') {
        showScreen('smartQuizScreen');
    } else if (quizMode === 'random') {
        showScreen('randomQuizScreen');
    } else if (quizMode === 'wrong') {
        showScreen('wrongQuizScreen');
    }

    loadQuestion();
}

// Keep backward compatibility
function markRandomAnswer(isCorrect) {
    markAnswer(isCorrect);
}

// Show answer screen
function showAnswerScreen(question, userAnswer, isCorrect) {
    const answerProgress = ((currentQuestionIndex + 1) / currentQuizSet.length) * 100;

    if (quizMode === 'smart') {
        document.getElementById('smartCorrectAnswer').textContent = question.en;
        document.getElementById('smartUserAnswer').textContent = userAnswer || '(답변 없음)';
        document.getElementById('smartAnswerCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
        document.getElementById('smartAnswerCorrect').textContent = correctCount;
        document.getElementById('smartAnswerTotalSessions').textContent = `${totalTestSessions}회`;
        document.getElementById('smartAnswerProgressBar').style.width = answerProgress + '%';

        // Update correct answer box styling based on result
        const correctAnswerBox = document.getElementById('smartCorrectAnswerBox');
        if (correctAnswerBox) {
            if (isCorrect) {
                correctAnswerBox.style.backgroundColor = '#d4edda';
                correctAnswerBox.style.borderColor = '#28a745';
            } else {
                correctAnswerBox.style.backgroundColor = '#f8d7da';
                correctAnswerBox.style.borderColor = '#dc3545';
            }
        }

        showScreen('smartAnswerScreen');

    } else if (quizMode === 'wrong') {
        document.getElementById('wrongCorrectAnswer').textContent = question.en;
        document.getElementById('wrongUserAnswer').textContent = userAnswer || '(답변 없음)';
        document.getElementById('wrongAnswerCurrentQuestion').textContent = `${currentQuestionIndex + 1}/${currentQuizSet.length}`;
        document.getElementById('wrongAnswerCorrect').textContent = correctCount;
        document.getElementById('wrongAnswerTotalSessions').textContent = `${totalTestSessions}회`;
        document.getElementById('wrongAnswerProgressBar').style.width = answerProgress + '%';

        // Update correct answer box styling based on result
        const correctAnswerBox = document.getElementById('wrongCorrectAnswerBox');
        if (correctAnswerBox) {
            if (isCorrect) {
                correctAnswerBox.style.backgroundColor = '#d4edda';
                correctAnswerBox.style.borderColor = '#28a745';
            } else {
                correctAnswerBox.style.backgroundColor = '#f8d7da';
                correctAnswerBox.style.borderColor = '#dc3545';
            }
        }

        showScreen('wrongAnswerScreen');
    }
}

// Get random mode tested count
function getRandomModeTestedCount() {
    const progress = loadProgress();
    return progress.filter(p => p.attempts > 0).length;
}

// Get random mode remaining count
function getRandomModeRemainingCount() {
    const progress = loadProgress();
    const untestedCount = progress.filter(p => p.attempts === 0).length;

    // If all are untested (just reset) or none are untested (about to reset)
    // Return the actual count of untested items
    return untestedCount;
}

// Next question
function nextQuestion() {
    if (autoNextTimer) {
        clearInterval(autoNextTimer);
        autoNextTimer = null;
    }

    currentQuestionIndex++;

    // Show appropriate quiz screen based on mode
    if (quizMode === 'smart') {
        showScreen('smartQuizScreen');
    } else if (quizMode === 'random') {
        showScreen('randomQuizScreen');
    } else if (quizMode === 'wrong') {
        showScreen('wrongQuizScreen');
    }

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

    // Increment total test sessions
    totalTestSessions++;
    localStorage.setItem('totalTestSessions', totalTestSessions.toString());

    // Check if random mode completed a full round
    if (quizMode === 'random') {
        const testedCount = getRandomModeTestedCount();
        if (testedCount >= sentences.length) {
            randomModeCompleteRounds++;
            localStorage.setItem('randomModeCompleteRounds', randomModeCompleteRounds.toString());
        }
    }

    if (quizMode === 'random') {
        // For random mode, show correct/wrong counts
        const remainingCount = getRandomModeRemainingCount();
        const correctAnswers = quizResults.filter(r => r.correct).length;
        const wrongAnswers = quizResults.filter(r => !r.correct).length;

        document.getElementById('finalCorrect').textContent = correctAnswers;
        document.getElementById('finalWrong').textContent = wrongAnswers;
        document.getElementById('finalScore').textContent = `${remainingCount}개`;

        // Update stat labels for random mode
        const statItems = document.querySelectorAll('#resultScreen .stat-item');
        if (statItems.length >= 3) {
            const labels = statItems[0].querySelector('.stat-label');
            if (labels) labels.textContent = '정답';

            const labelsWrong = statItems[1].querySelector('.stat-label');
            if (labelsWrong) labelsWrong.textContent = '오답';

            const labelsScore = statItems[2].querySelector('.stat-label');
            if (labelsScore) labelsScore.textContent = '남은 문제';
        }

        // Build result list for random mode with correct/wrong indication
        const resultList = document.getElementById('resultList');
        resultList.innerHTML = '<h2 style="margin-bottom: 15px;">학습한 표현</h2>';

        quizResults.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'result-item ' + (result.correct ? 'correct' : 'wrong');
            item.style.cursor = 'pointer';

            // Extract full dialogue in order (A and B's parts)
            const fullDialogue = extractFullDialogue(result.question.ko, result.question.en);
            item.onclick = () => {
                // Speak full dialogue in order (A then B)
                speakEnglish(fullDialogue);
            };

            let html = `
                <div style="font-weight: bold; margin-bottom: 8px;">${index + 1}. ${result.correct ? '⭕' : '❌'}</div>
                <div class="english" style="font-size: 1.05em; color: #333; white-space: pre-line;">${fullDialogue}</div>
            `;

            item.innerHTML = html;
            resultList.appendChild(item);
        });
    } else {
        // For other modes, show normal scoring
        const wrongCount = quizResults.filter(r => !r.correct).length;
        const score = Math.round((correctCount / quizResults.length) * 100);

        document.getElementById('finalCorrect').textContent = correctCount;
        document.getElementById('finalWrong').textContent = wrongCount;
        document.getElementById('finalScore').textContent = score + '%';

        // Reset stat labels for non-random modes
        const statItems = document.querySelectorAll('#resultScreen .stat-item');
        if (statItems.length >= 3) {
            const labels = statItems[0].querySelector('.stat-label');
            if (labels) labels.textContent = '정답';

            const labelsWrong = statItems[1].querySelector('.stat-label');
            if (labelsWrong) labelsWrong.textContent = '오답';

            const labelsScore = statItems[2].querySelector('.stat-label');
            if (labelsScore) labelsScore.textContent = '점수';
        }

        // Build result list
        const resultList = document.getElementById('resultList');
        resultList.innerHTML = '<h2 style="margin-bottom: 15px;">상세 결과</h2>';

        quizResults.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'result-item ' + (result.correct ? 'correct' : 'wrong');
            item.style.cursor = 'pointer';

            // Extract full dialogue in order (A and B's parts)
            const fullDialogue = extractFullDialogue(result.question.ko, result.question.en);
            item.onclick = () => {
                // Speak full dialogue in order (A then B)
                speakEnglish(fullDialogue);
            };

            let html = `
                <div style="font-weight: bold; margin-bottom: 8px;">${index + 1}. ${result.correct ? '⭕' : '❌'}</div>
                <div class="english" style="font-size: 1.05em; color: #333; white-space: pre-line;">${fullDialogue}</div>
            `;

            item.innerHTML = html;
            resultList.appendChild(item);
        });
    }

    showScreen('resultScreen');
    updateStartScreenStats();
}

// Continue with next 10 questions
function continueQuiz() {
    // Select next 10 questions
    currentQuizSet = selectQuestions();

    if (currentQuizSet.length === 0) {
        alert('더 이상 진행할 문제가 없습니다.');
        showScreen('startScreen');
        return;
    }

    currentQuestionIndex = 0;
    correctCount = 0;
    quizResults = [];

    // Show appropriate quiz screen based on mode
    if (quizMode === 'smart') {
        showScreen('smartQuizScreen');
    } else if (quizMode === 'random') {
        showScreen('randomQuizScreen');
    } else if (quizMode === 'wrong') {
        showScreen('wrongQuizScreen');
    }

    loadQuestion();
}

// Restart quiz
function restartQuiz() {
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

    showScreen('startScreen');
}

// Go back to home (cancel current quiz or from result screen)
function goHome() {
    // Stop TTS
    stopTTS();

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

    // Check if we're on the result screen
    const resultScreen = document.getElementById('resultScreen');
    const isResultScreen = resultScreen && resultScreen.classList.contains('active');

    // If on result screen, go home without confirmation
    if (isResultScreen) {
        showScreen('startScreen');
        return;
    }

    // Otherwise, confirm before leaving if quiz is in progress
    if (confirm('진행 중인 테스트를 종료하시겠습니까?')) {
        showScreen('startScreen');
    }
}

// Show screen
function showScreen(screenId, addToHistory = true) {
    // Stop TTS when changing screens
    stopTTS();

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

                // Handle updates - show confirmation dialog
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    console.log('[App] New service worker found, installing...');

                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker is ready - ask user
                            console.log('[App] New version available!');

                            if (confirm('새로운 버전이 있습니다. 지금 업데이트하시겠습니까?')) {
                                newWorker.postMessage({ action: 'skipWaiting' });
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

import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;
let activeSeconds = 0;
let lastActivityTime = Date.now();
let isPaused = false;

const IDLE_TIMEOUT = 180 * 1000; // 2 минуты неактивности (в миллисекундах)
const BREAK_INTERVAL = 3600; // 1 час активной работы (в секундах)
let breakNotificationShown = false;

let timerInterval: NodeJS.Timeout | undefined;
let globalContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    globalContext = context;
    loadTodayData();

    // 1. Создание элемента в статус-баре (внизу справа)
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'typingTracker.showStats';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();
    statusBarItem.show();

    // 2. Отслеживание ввода текста в редакторе
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.scheme === 'file') {
                registerActivity();
            }
        })
    );

    // 3. Регистрация команд
    context.subscriptions.push(
        vscode.commands.registerCommand('typingTracker.showStats', () => {
            showStatisticsPanel(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('typingTracker.resetTimer', () => {
            activeSeconds = 0;
            saveTodayData();
            updateStatusBar();
            vscode.window.showInformationMessage('Timer for today has been reset.');
        })
    );

    // 4. Запуск таймера, который проверяет активность каждую секунду
    timerInterval = setInterval(() => {
        const now = Date.now();
        const diff = now - lastActivityTime;

        if (diff > IDLE_TIMEOUT) {
            if (!isPaused) {
                isPaused = true;
                updateStatusBar();
            }
        } else {
            if (isPaused) {
                isPaused = false;
            }
            activeSeconds++;
            checkBreakTime();
            updateStatusBar();

            // Сохраняем данные в память каждые 30 секунд
            if (activeSeconds % 30 === 0) {
                saveTodayData();
            }
        }
    }, 1000);

    context.subscriptions.push({
        dispose: () => {
            if (timerInterval) clearInterval(timerInterval);
        }
    });
}

function registerActivity() {
    lastActivityTime = Date.now();
    if (isPaused) {
        isPaused = false;
        updateStatusBar();
    }
}

function getTodayKey(): string {
    const date = new Date().toISOString().split('T')[0]; // Получаем дату в формате YYYY-MM-DD
    return `codingTime_${date}`;
}

function saveTodayData() {
    if (!globalContext) return;
    const key = getTodayKey();
    globalContext.globalState.update(key, activeSeconds);
}

function loadTodayData() {
    if (!globalContext) return;
    const key = getTodayKey();
    const saved = globalContext.globalState.get<number>(key);
    activeSeconds = saved || 0;
}

function updateStatusBar() {
    const formattedTime = formatTime(activeSeconds);
    if (isPaused) {
        statusBarItem.text = `$(coffee) Paused (${formattedTime})`;
        statusBarItem.tooltip = 'Timer is paused due to inactivity';
    } else {
        statusBarItem.text = `$(pulse) Coding: ${formattedTime}`;
        statusBarItem.tooltip = 'Active coding time today (Click for statistics & charts)';
    }
}

function formatTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) {
        return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

function checkBreakTime() {
    if (activeSeconds > 0 && activeSeconds % BREAK_INTERVAL === 0) {
        if (!breakNotificationShown) {
            breakNotificationShown = true;
            vscode.window
                .showWarningMessage(
                    'You have been coding continuously for 1 hour! Time for a short eye break and stretch.',
                    'Take a Break',
                    'Dismiss'
                )
                .then((selection) => {
                    if (selection === 'Take a Break') {
                        lastActivityTime = Date.now() + 10 * 60 * 1000; // Пауза на 10 минут
                        isPaused = true;
                        updateStatusBar();
                    }
                });
            setTimeout(() => {
                breakNotificationShown = false;
            }, 60000);
        }
    }
}

// 5. Создание панели с графиком статистики
function showStatisticsPanel(context: vscode.ExtensionContext) {
    saveTodayData();

    const panel = vscode.window.createWebviewPanel(
        'typingStats',
        'Active Typing Statistics',
        vscode.ViewColumn.One,
        { 
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'media')]
        }
    );

    const scriptPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'media', 'chart.js');
    const chartJsUri = panel.webview.asWebviewUri(scriptPathOnDisk);

    // Передаем оба аргумента:
    panel.webview.html = getWebviewContent(context, chartJsUri);
}

// Принимаем оба аргумента:
function getWebviewContent(context: vscode.ExtensionContext, chartJsUri: vscode.Uri): string {
    const chartLabels: string[] = [];
    const chartData: number[] = [];

    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const key = `codingTime_${dateStr}`;
        const seconds = context.globalState.get<number>(key) || 0;
        
        chartLabels.push(dateStr);
        chartData.push(Number((seconds / 3600).toFixed(2)));
    }

    const todayHours = (activeSeconds / 3600).toFixed(2);
    const todayFormatted = formatTime(activeSeconds);

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Typing Statistics</title>
        <!-- Используем локальный файл chart.js -->
        <script src="${chartJsUri}"></script>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px;
            }
            .card {
                background: var(--vscode-editorWidget-background);
                border: 1px solid var(--vscode-editorWidget-border);
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 20px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            h1, h2 { color: var(--vscode-textLink-activeForeground); }
            .stat-value {
                font-size: 2em;
                font-weight: bold;
                color: var(--vscode-charts-green);
            }
            canvas {
                max-height: 350px;
                width: 100% !important;
            }
        </style>
    </head>
    <body>
        <h1>Active Typing Time Tracker</h1>
        
        <div class="card">
            <h2>Today's Summary</h2>
            <p>Active Coding Time: <span class="stat-value">${todayFormatted}</span> (${todayHours} hours)</p>
        </div>

        <div class="card">
            <h2>Last 7 Days Activity (Hours)</h2>
            <canvas id="weeklyChart"></canvas>
        </div>

        <script>
            const ctx = document.getElementById('weeklyChart').getContext('2d');
            const weeklyChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ${JSON.stringify(chartLabels)},
                    datasets: [{
                        label: 'Active Hours',
                        data: ${JSON.stringify(chartData)},
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Hours'
                            }
                        }
                    }
                }
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {
    saveTodayData();
}
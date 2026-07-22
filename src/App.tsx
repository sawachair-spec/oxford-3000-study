import { useEffect, useMemo, useState } from "react";

type Cefr = "A1" | "A2" | "B1" | "B2";
type View = "home" | "search" | "study" | "quiz" | "history" | "detail";
type Result = "unknown" | "uncertain" | "known" | "correct" | "incorrect";

type WordRecord = {
  id: string;
  cefr: Cefr;
  word: string;
  sense_label: string;
  part_of_speech: string;
  japanese_gloss: string;
  english_definition: string;
  japanese_definition: string;
  source_url: string;
};

type LearningHistory = {
  history_id: string;
  record_id: string;
  studied_at: string;
  mode: "card" | "quiz";
  direction: "en-ja" | "ja-en";
  result: Result;
};

const CEFRS: Cefr[] = ["A1", "A2", "B1", "B2"];
const HISTORY_KEY = "word-study-history-v1";
const WEEKLY_SET_KEY = "word-study-weekly-set-v1";
const DAILY_TARGET = 200;

const posJa: Record<string, string> = {
  noun: "名詞", verb: "動詞", adjective: "形容詞", adverb: "副詞",
  preposition: "前置詞", pronoun: "代名詞", conjunction: "接続詞",
  determiner: "限定詞", "modal verb": "法助動詞", "auxiliary verb": "助動詞",
  number: "数詞", exclamation: "間投詞", "definite article": "定冠詞",
  "indefinite article": "不定冠詞", "infinitive marker": "不定詞標識",
  "ordinal number": "序数",
};

const resultLabel: Record<Result, string> = {
  unknown: "わからない", uncertain: "あいまい", known: "わかった",
  correct: "正解", incorrect: "不正解",
};

function displayWord(word: string) {
  return word.replace(/\d+$/, "");
}

function formatTime(iso: string) {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "たった今";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function getWeekStart(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const daysFromMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysFromMonday);
  return start;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chooseWeeklySet(records: WordRecord[], preferredId?: string | null) {
  const selectedIds: string[] = [];
  const usedWords = new Set<string>();
  const preferred = preferredId ? records.find((record) => record.id === preferredId) : undefined;
  const candidates = preferred ? [preferred, ...shuffle(records.filter((record) => record.id !== preferred.id))] : shuffle(records);
  for (const record of candidates) {
    const wordKey = displayWord(record.word).toLocaleLowerCase();
    if (usedWords.has(wordKey)) continue;
    usedWords.add(wordKey);
    selectedIds.push(record.id);
    if (selectedIds.length === DAILY_TARGET) break;
  }
  return selectedIds;
}

export default function Home() {
  const [records, setRecords] = useState<WordRecord[]>([]);
  const [history, setHistory] = useState<LearningHistory[]>([]);
  const [view, setView] = useState<View>("home");
  const [searchCefr, setSearchCefr] = useState<Cefr>("A1");
  const [selected, setSelected] = useState<WordRecord | null>(null);
  const [weeklySetIds, setWeeklySetIds] = useState<string[]>([]);
  const [studyOrderIds, setStudyOrderIds] = useState<string[]>([]);
  const [studyIndex, setStudyIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [direction, setDirection] = useState<"en-ja" | "ja-en">("en-ja");
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState("all");
  const [quizChoices, setQuizChoices] = useState<WordRecord[]>([]);
  const [quizAnswered, setQuizAnswered] = useState<string | null>(null);

  useEffect(() => {
    const dataFiles = [1, 2, 3, 4].map(
      (part) => `${import.meta.env.BASE_URL}data/oxford-3000-${part}.json`,
    );
    Promise.all(
      dataFiles.map((file) =>
        fetch(file).then((response) => {
          if (!response.ok) throw new Error(`Failed to load ${file}`);
          return response.json();
        }),
      ),
    )
      .then((parts) => setRecords(parts.flatMap((part) => part.records ?? [])))
      .catch(() => setRecords([]));
    Promise.resolve().then(() => {
      try {
        setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"));
      } catch {
        setHistory([]);
      }
    });
  }, []);

  useEffect(() => {
    if (history.length) localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const recordMap = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  useEffect(() => {
    if (!records.length) {
      setWeeklySetIds([]);
      setStudyOrderIds([]);
      return;
    }
    const weekKey = formatDateKey(getWeekStart());
    const poolKey = "ALL";
    const availableIds = new Set(records.map((record) => record.id));
    let savedIds: string[] = [];
    try {
      const saved = JSON.parse(localStorage.getItem(WEEKLY_SET_KEY) ?? "{}");
      if (saved.weekKey === weekKey && saved.poolKey === poolKey && Array.isArray(saved.recordIds)) {
        savedIds = saved.recordIds.filter((id: unknown): id is string => typeof id === "string" && availableIds.has(id));
      }
    } catch {
      savedIds = [];
    }
    const expectedSize = Math.min(DAILY_TARGET, new Set(records.map((record) => displayWord(record.word).toLocaleLowerCase())).size);
    const weeklyIds = savedIds.length === expectedSize ? savedIds : chooseWeeklySet(records);
    localStorage.setItem(WEEKLY_SET_KEY, JSON.stringify({ weekKey, poolKey, recordIds: weeklyIds }));
    setWeeklySetIds(weeklyIds);
    setStudyOrderIds(shuffle(weeklyIds));
    setStudyIndex(0);
    setRevealed(false);
  }, [records]);

  const studyDeck = useMemo(
    () => studyOrderIds.map((id) => recordMap.get(id)).filter((record): record is WordRecord => Boolean(record)),
    [studyOrderIds, recordMap],
  );
  const current = studyDeck[studyIndex % Math.max(studyDeck.length, 1)] ?? null;
  const studiedIds = useMemo(() => new Set(history.map((item) => item.record_id)), [history]);
  const correctCount = history.filter((item) => item.result === "known" || item.result === "correct").length;
  const accuracy = history.length ? Math.round((correctCount / history.length) * 100) : 0;
  const todayKey = new Date().toDateString();
  const todayHistory = history.filter((item) => new Date(item.studied_at).toDateString() === todayKey);
  const weeklySetIdSet = useMemo(() => new Set(weeklySetIds), [weeklySetIds]);
  const todayStudiedIds = new Set(todayHistory.filter((item) => weeklySetIdSet.has(item.record_id)).map((item) => item.record_id));
  const dailyProgress = Math.min(100, Math.round((todayStudiedIds.size / (weeklySetIds.length || DAILY_TARGET)) * 100));
  const weekStart = getWeekStart();
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(weekStart);
    start.setDate(start.getDate() + index);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const studied = new Set(
      history
        .filter((item) => {
          const studiedAt = new Date(item.studied_at);
          return studiedAt >= start && studiedAt < end && weeklySetIdSet.has(item.record_id);
        })
        .map((item) => item.record_id),
    ).size;
    return { label: ["月", "火", "水", "木", "金", "土", "日"][index], studied, isToday: formatDateKey(start) === formatDateKey(new Date()) };
  });

  const positions = useMemo(
    () => Array.from(new Set(records.map((record) => record.part_of_speech))).sort(),
    [records],
  );

  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return records.filter((record) => {
      const matchesCefr = record.cefr === searchCefr;
      const matchesPos = posFilter === "all" || record.part_of_speech === posFilter;
      const haystack = `${record.word} ${record.japanese_gloss} ${record.sense_label} ${record.english_definition}`.toLocaleLowerCase();
      return matchesCefr && matchesPos && (!needle || haystack.includes(needle));
    }).slice(0, 80);
  }, [records, query, searchCefr, posFilter]);

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reshuffleStudy() {
    setStudyOrderIds((ids) => shuffle(ids));
    setStudyIndex(0);
    setRevealed(false);
    setQuizAnswered(null);
  }

  function openRecord(record: WordRecord) {
    setSelected(record);
    navigate("detail");
  }

  function addHistory(record: WordRecord, mode: "card" | "quiz", result: Result) {
    const entry: LearningHistory = {
      history_id: crypto.randomUUID(), record_id: record.id,
      studied_at: new Date().toISOString(), mode, direction, result,
    };
    setHistory((items) => [entry, ...items]);
  }

  function rateCard(result: Result) {
    if (!current) return;
    addHistory(current, "card", result);
    setRevealed(false);
    setStudyIndex((value) => value + 1);
  }

  function startQuiz() {
    if (!current) return;
    const distractors = records
      .filter((record) => record.id !== current.id && displayWord(record.word) !== displayWord(current.word))
      .sort(() => Math.random() - 0.5).slice(0, 3);
    setQuizChoices([current, ...distractors].sort(() => Math.random() - 0.5));
    setQuizAnswered(null);
    navigate("quiz");
  }

  function answerQuiz(choice: WordRecord) {
    if (!current || quizAnswered) return;
    setQuizAnswered(choice.id);
    addHistory(current, "quiz", choice.id === current.id ? "correct" : "incorrect");
  }

  function nextQuiz() {
    setStudyIndex((value) => value + 1);
    setTimeout(() => {
      const next = studyDeck[(studyIndex + 1) % Math.max(studyDeck.length, 1)];
      if (!next) return;
      const distractors = records
        .filter((record) => record.id !== next.id && displayWord(record.word) !== displayWord(next.word))
        .sort(() => Math.random() - 0.5).slice(0, 3);
      setQuizChoices([next, ...distractors].sort(() => Math.random() - 0.5));
      setQuizAnswered(null);
    }, 0);
  }

  function studySpecificRecord(record: WordRecord) {
    const updatedSet = weeklySetIds.includes(record.id)
      ? weeklySetIds
      : [record.id, ...weeklySetIds].slice(0, DAILY_TARGET);
    setWeeklySetIds(updatedSet);
    setStudyOrderIds([record.id, ...shuffle(updatedSet.filter((id) => id !== record.id))]);
    localStorage.setItem(WEEKLY_SET_KEY, JSON.stringify({
      weekKey: formatDateKey(getWeekStart()),
      poolKey: "ALL",
      recordIds: updatedSet,
    }));
    setStudyIndex(0);
    setRevealed(false);
    navigate("study");
  }

  function exportHistory() {
    const blob = new Blob([JSON.stringify({ version: 1, history }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `word-study-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="topbar">
          <button className="brand" onClick={() => navigate("home")}>Word Study <small>3,809 records</small></button>
          <span className="local-save"><i /> この端末に保存</span>
        </header>

        {view === "home" && (
          <div className="page home-page">
            <section className="hero-focus">
              <p className="eyebrow">PERSONAL VOCABULARY</p>
              <h1>今日も少しずつ</h1>
              <p className="muted">覚えた分だけ、履歴に残ります。</p>
              <button className="primary-cta" onClick={() => navigate("study")}><span>▶</span> 学習を始める</button>
              <div className="weekly-goal-card">
                <div className="weekly-goal-head">
                  <span>今日の200単語</span>
                  <b>同じセットを7日間</b>
                </div>
                <div className="weekly-progress"><i style={{ width: `${dailyProgress}%` }} /></div>
                <p><strong>{todayStudiedIds.size}</strong> / {weeklySetIds.length || DAILY_TARGET} 単語 <span>毎週月曜に更新</span></p>
                <div className="week-days" aria-label="今週の学習状況">
                  {weekDays.map((day) => <div key={day.label} className={day.isToday ? "today" : day.studied >= (weeklySetIds.length || DAILY_TARGET) ? "done" : ""}><span>{day.label}</span><b>{day.studied}</b></div>)}
                </div>
              </div>
            </section>

            <section>
              <div className="section-heading"><h2>今日の学習</h2><span>{todayHistory.length ? "記録中" : "これから"}</span></div>
              <div className="today-stats">
                <div><strong>{todayHistory.length}</strong><span>学習した語義</span></div>
                <div><strong>{accuracy}<em>%</em></strong><span>正解・理解率</span></div>
                <div><strong>{studiedIds.size}</strong><span>累計語義</span></div>
              </div>
            </section>

            <section className="paper-section">
              <div className="section-heading editorial"><h2>最近の学習</h2><button onClick={() => navigate("history")}>すべて見る</button></div>
              <p className="all-levels-note">A1〜B2の全単語からランダム出題</p>
              <div className="recent-list">
                {history.slice(0, 4).map((item) => {
                  const record = recordMap.get(item.record_id);
                  if (!record) return null;
                  return <button className="history-card" key={item.history_id} onClick={() => openRecord(record)}>
                    <span className="time">{formatTime(item.studied_at)}</span>
                    <span className="history-word">{displayWord(record.word)}</span>
                    <span className="history-meta"><b>{record.cefr}</b><b>{posJa[record.part_of_speech] ?? record.part_of_speech}</b>{record.japanese_gloss}</span>
                    <span className={`result ${item.result}`}>{resultLabel[item.result]}</span><span className="chevron">›</span>
                  </button>;
                })}
                {!history.length && <div className="empty-state">まだ学習履歴がありません。<br />最初のカードを開いてみましょう。</div>}
              </div>
              <p className="public-note">個人学習用の非公式プロジェクトです。Oxford University PressおよびOxford Learner&apos;s Dictionariesとは提携していません。</p>
            </section>
          </div>
        )}

        {view === "search" && (
          <div className="page">
            <div className="page-title"><p>WORD LIST</p><h1>単語を探す</h1></div>
            <div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="英単語・日本語訳・定義を検索" /></div>
            <div className="filter-row">
              <div className="cefr-pills compact">{CEFRS.map((level) => <button key={level} className={searchCefr === level ? "active" : ""} onClick={() => setSearchCefr(level)}>{level}</button>)}</div>
              <select value={posFilter} onChange={(event) => setPosFilter(event.target.value)} aria-label="品詞">
                <option value="all">すべての品詞</option>
                {positions.map((pos) => <option value={pos} key={pos}>{posJa[pos] ?? pos}</option>)}
              </select>
            </div>
            <p className="result-count">{searchResults.length}{searchResults.length === 80 ? "+" : ""}件を表示</p>
            <div className="word-list">
              {searchResults.map((record) => <button className="word-row" key={record.id} onClick={() => openRecord(record)}>
                <span className="word-main"><strong>{displayWord(record.word)}</strong><small>{record.sense_label}</small></span>
                <span className="word-gloss"><i>{record.cefr}</i><i>{posJa[record.part_of_speech] ?? record.part_of_speech}</i>{record.japanese_gloss}</span>
                <span className="chevron">›</span>
              </button>)}
            </div>
          </div>
        )}

        {view === "study" && (
          <div className="page study-page">
            <div className="study-head"><button onClick={() => navigate("home")}>‹ 終了</button><span>{studyDeck.length ? (studyIndex % studyDeck.length) + 1 : 0} / {studyDeck.length}</span><button onClick={startQuiz}>4択クイズ</button></div>
            <div className="study-settings">
              <span className="study-pool-note">全3,809レコードから選ばれた今週の200単語</span>
              <div className="study-controls">
                <button className="shuffle-button" onClick={reshuffleStudy}>順番をシャッフル</button>
                <button className="direction-toggle" onClick={() => setDirection((value) => value === "en-ja" ? "ja-en" : "en-ja")}>{direction === "en-ja" ? "英 → 日" : "日 → 英"}</button>
              </div>
            </div>
            {current ? <>
              <section className={`study-card ${revealed ? "revealed" : ""}`}>
                <span className="level-chip">{current.cefr} · {posJa[current.part_of_speech] ?? current.part_of_speech}</span>
                <p className="prompt-label">{direction === "en-ja" ? "この語義は？" : "この英単語は？"}</p>
                <h1>{direction === "en-ja" ? displayWord(current.word) : current.japanese_gloss}</h1>
                <p className="sense">{direction === "en-ja" ? current.sense_label : current.japanese_definition}</p>
                {revealed && <div className="answer-panel">
                  <span>ANSWER</span><h2>{direction === "en-ja" ? current.japanese_gloss : displayWord(current.word)}</h2>
                  <p>{current.english_definition}</p><p>{current.japanese_definition}</p>
                </div>}
              </section>
              {!revealed ? <button className="primary-cta reveal-button" onClick={() => setRevealed(true)}>答えを見る</button> :
                <div className="rating-buttons">
                  <button onClick={() => rateCard("unknown")}><b>1</b>わからない</button>
                  <button onClick={() => rateCard("uncertain")}><b>2</b>あいまい</button>
                  <button className="good" onClick={() => rateCard("known")}><b>3</b>わかった</button>
                </div>}
            </> : <div className="loading">単語データを読み込んでいます。</div>}
          </div>
        )}

        {view === "quiz" && current && (
          <div className="page quiz-page">
            <div className="study-head"><button onClick={() => navigate("study")}>‹ カード</button><span>4択クイズ</span><span>{current.cefr}</span></div>
            <section className="quiz-question"><p>意味に合う単語を選んでください</p><h1>{current.japanese_gloss}</h1><span>{posJa[current.part_of_speech] ?? current.part_of_speech}</span></section>
            <div className="quiz-choices">
              {quizChoices.map((choice, index) => {
                const answered = Boolean(quizAnswered);
                const isCorrect = choice.id === current.id;
                const chosen = choice.id === quizAnswered;
                return <button key={choice.id} onClick={() => answerQuiz(choice)} className={answered && isCorrect ? "correct" : answered && chosen ? "wrong" : ""}>
                  <b>{index + 1}</b><span>{displayWord(choice.word)}<small>{posJa[choice.part_of_speech] ?? choice.part_of_speech}</small></span>
                </button>;
              })}
            </div>
            {quizAnswered && <div className="quiz-feedback"><strong>{quizAnswered === current.id ? "正解です" : `正解は ${displayWord(current.word)}`}</strong><button className="primary-cta" onClick={nextQuiz}>次の問題へ</button></div>}
          </div>
        )}

        {view === "history" && (
          <div className="page">
            <div className="page-title"><p>YOUR RECORDS</p><h1>学習履歴</h1><span>{history.length}回の学習 · {studiedIds.size}語義</span></div>
            <div className="history-summary"><div><strong>{accuracy}%</strong><span>理解・正解</span></div><div><strong>{history.filter((item) => item.result === "unknown" || item.result === "incorrect").length}</strong><span>要復習</span></div></div>
            <button className="export-button" onClick={exportHistory}>履歴をJSONで保存</button>
            <div className="recent-list full-history">
              {history.map((item) => {
                const record = recordMap.get(item.record_id);
                if (!record) return null;
                return <button className="history-card" key={item.history_id} onClick={() => openRecord(record)}>
                  <span className="time">{formatTime(item.studied_at)}</span><span className="history-word">{displayWord(record.word)}</span>
                  <span className="history-meta"><b>{record.cefr}</b><b>{posJa[record.part_of_speech] ?? record.part_of_speech}</b>{record.japanese_gloss}</span>
                  <span className={`result ${item.result}`}>{resultLabel[item.result]}</span><span className="chevron">›</span>
                </button>;
              })}
              {!history.length && <div className="empty-state">学習すると、ここに履歴が残ります。</div>}
            </div>
          </div>
        )}

        {view === "detail" && selected && (
          <div className="page detail-page">
            <button className="back-button" onClick={() => navigate("search")}>‹ 単語一覧へ</button>
            <section className="detail-hero"><span>{selected.cefr} · {posJa[selected.part_of_speech] ?? selected.part_of_speech}</span><h1>{displayWord(selected.word)}</h1><p>{selected.sense_label}</p></section>
            <section className="definition-card"><label>日本語訳</label><h2>{selected.japanese_gloss}</h2><label>English definition</label><p>{selected.english_definition}</p><label>日本語定義</label><p>{selected.japanese_definition}</p></section>
            <a className="source-link" href={selected.source_url} target="_blank" rel="noreferrer">Oxford Learner&apos;s Dictionariesで参照 ↗</a>
            <button className="primary-cta" onClick={() => studySpecificRecord(selected)}>このカードを学習する</button>
          </div>
        )}

        <nav className="bottom-nav" aria-label="メインナビゲーション">
          <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}><i className="home-icon" />ホーム</button>
          <button className={view === "search" || view === "detail" ? "active" : ""} onClick={() => navigate("search")}><i className="search-icon" />探す</button>
          <button className={view === "study" || view === "quiz" ? "active" : ""} onClick={() => navigate("study")}><i className="book-icon" />学習</button>
          <button className={view === "history" ? "active" : ""} onClick={() => navigate("history")}><i className="history-icon" />履歴</button>
        </nav>
      </div>
    </main>
  );
}

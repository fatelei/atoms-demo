"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildApp } from "../lib/build-events.js";
import { previewDocument } from "../lib/preview.js";

// Allow submit events to reach app handlers. The preview CSP blocks form navigation.
const previewSandbox = "allow-scripts allow-forms";

const storageKey = "atoms-demo-projects-v1";
const examples = [
  { label: "活动报名表", prompt: "做一个周末活动报名表，可以新增和删除报名，并实时统计已报名人数。" },
  { label: "习惯打卡器", prompt: "做一个习惯打卡器，可以添加习惯、切换今日完成状态，并显示今日完成进度。" },
  { label: "预算计算器", prompt: "做一个旅行预算计算器，可以新增和删除支出，实时计算总费用和人均费用。" },
];

const stageText = {
  planning: "正在拆解需求",
  building: "正在编写应用代码",
  checking: "正在检查源码",
  repairing: "正在修正源码",
  previewing: "正在启动应用预览",
  acceptance: "正在试跑应用交互",
};

function createFrame(app, steps) {
  const token = crypto.randomUUID();
  return { token, source: previewDocument(app, token, steps) };
}

function VersionAcceptance({ results }) {
  if (!Array.isArray(results)) return null;
  if (results.length === 0) return <p className="acceptance-empty">本版暂无可运行的交互检查。</p>;

  const passed = results.filter((result) => result.passed).length;
  return (
    <details className="acceptance">
      <summary>版本验收 · {passed}/{results.length} 项通过</summary>
      <ul>
        {results.map((result, index) => (
          <li key={index}>
            <span className={result.passed ? "acceptance-pass" : "acceptance-fail"}>
              {result.passed ? "通过" : "未通过"}
            </span>
            <span>{result.scope === "regression" ? "回归 · " : ""}{result.title}</span>
            {!result.passed && (
              <p>
                {result.step ? `第 ${result.step} 步 · ` : ""}
                {result.expected !== undefined ? `预期「${result.expected}」 · ` : ""}
                {result.expected !== undefined ? "实际 " : ""}
                {result.actual || "检查未返回结果"}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function PromptForm({ value, onChange, onSubmit, disabled, label, placeholder, focusRef, primary }) {
  function submit(event) {
    event.preventDefault();
    if (value.trim() && !disabled) onSubmit(value.trim());
  }

  return (
    <form className={primary ? "prompt-card" : "prompt-card composer"} onSubmit={submit}>
      <label className="sr-only" htmlFor="prompt">{placeholder}</label>
      <textarea
        ref={focusRef}
        id="prompt"
        value={value}
        maxLength={2000}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
        }}
      />
      <div className="prompt-actions">
        <span>{value.length} / 2000</span>
        <button className="primary-button" disabled={!value.trim() || disabled}>{label}</button>
      </div>
    </form>
  );
}

export default function Home() {
  const [projects, setProjects] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [job, setJob] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [tab, setTab] = useState("preview");
  const [history, setHistory] = useState(false);
  const [shownId, setShownId] = useState(null);
  const [reload, setReload] = useState(0);
  const [previewError, setPreviewError] = useState("");
  const [storageError, setStorageError] = useState(false);

  const pending = useRef(false);
  const candidateFrame = useRef(null);
  const liveFrame = useRef(null);
  const homeInput = useRef(null);
  const logEnd = useRef(null);
  const project = projects?.find((item) => item.id === activeId);
  const current = project?.versions.at(-1);
  const shown = project?.versions.find((item) => item.id === shownId) ?? current;
  const isHistorical = Boolean(shown && shown.id !== current?.id);
  const activeFrame = useMemo(() => shown ? createFrame(shown.app) : null, [shown, reload]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      setProjects(Array.isArray(stored) ? stored : []);
    } catch {
      setProjects([]);
      setStorageError(true);
    }
  }, []);

  useEffect(() => {
    if (projects === null) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(projects));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [projects]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [project?.turns.length, job?.stage, job?.steps, current?.id]);

  useEffect(() => {
    setPreviewError("");
    function receive(event) {
      if (
        event.origin === "null" &&
        event.source === liveFrame.current?.contentWindow &&
        event.data?.channel === "atoms-preview" &&
        event.data.token === activeFrame?.token &&
        event.data.kind === "error" &&
        typeof event.data.detail === "string"
      ) setPreviewError(event.data.detail.slice(0, 240));
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [activeFrame]);

  useEffect(() => {
    if (!candidate) return;

    const check = candidate.acceptance && candidate.app.checks?.[candidate.acceptance.length];
    let settled = false;
    function finish(error, acceptance = []) {
      if (settled) return;
      settled = true;
      const { projectId, turnId, app, steps } = candidate;
      setProjects((all) => all.map((item) => {
        if (item.id !== projectId) return item;
        const version = { id: turnId, number: item.versions.length + 1, app, acceptance };
        return {
          ...item,
          versions: error ? item.versions : [...item.versions, version],
          turns: item.turns.map((turn) => (
            turn.id === turnId ? { ...turn, steps, error, complete: !error } : turn
          )),
        };
      }));
      if (!error) {
        setShownId(null);
        setTab("preview");
      }
      pending.current = false;
      setJob(null);
      setCandidate(null);
    }

    function nextCheck(acceptance) {
      const next = candidate.app.checks?.[acceptance.length];
      if (!next) {
        finish("", acceptance);
        return;
      }
      settled = true;
      setCandidate({ ...candidate, acceptance, frame: createFrame(candidate.app, next.steps) });
    }

    function recordCheck(detail) {
      if (!check || settled) return;
      const actual = typeof detail.actual === "string" ? detail.actual.slice(0, 240) : undefined;
      const step = Number.isInteger(detail.step) && detail.step > 0 && detail.step <= check.steps.length
        ? detail.step : undefined;
      nextCheck([
        ...candidate.acceptance,
        {
          title: check.title,
          scope: check.scope,
          passed: detail.passed === true,
          actual,
          step,
          expected: typeof detail.expected === "string" ? detail.expected.slice(0, 180) : undefined,
        },
      ]);
    }

    function receive(event) {
      const data = event.data;
      if (
        event.origin !== "null" ||
        event.source !== candidateFrame.current?.contentWindow ||
        data?.channel !== "atoms-preview" ||
        data.token !== candidate.frame.token
      ) return;
      if (data.kind === "error") {
        if (check) recordCheck({ actual: data.detail });
        else finish("应用启动时出错" + (typeof data.detail === "string" && data.detail ? " · " + data.detail.slice(0, 240) : "。"));
      } else if (check && data.kind === "check" && typeof data.detail?.passed === "boolean") {
        recordCheck(data.detail);
      } else if (!check && data.kind === "ready" && !settled) {
        if (candidate.app.checks?.length) setJob((job) => ({ ...job, stage: "acceptance" }));
        nextCheck([]);
      }
    }

    window.addEventListener("message", receive);
    const timeout = window.setTimeout(() => {
      if (check) recordCheck({ actual: "检查超时" });
      else finish("预览未能启动，可以重试这条需求。");
    }, check ? 3500 : 6000);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [candidate]);

  function selectProject(id) {
    if (pending.current) return;
    setActiveId(id);
    setShownId(null);
    setHistory(false);
    setTab("preview");
    setPrompt("");
  }

  async function runBuild(target, request, retryTurn) {
    if (pending.current) return;

    pending.current = true;
    const base = retryTurn
      ? target.versions.find((version) => version.id === retryTurn.baseId)
      : target.versions.at(-1);
    const turn = retryTurn
      ? { ...retryTurn, error: "", steps: [] }
      : { id: crypto.randomUUID(), prompt: request, baseId: base?.id ?? null, steps: [], error: "", complete: false };

    setProjects((all) => all.map((item) => {
      if (item.id !== target.id) return item;
      const turns = retryTurn ? item.turns.map((entry) => entry.id === turn.id ? turn : entry) : [...item.turns, turn];
      return { ...item, turns };
    }));
    setJob({ turnId: turn.id, stage: "planning", steps: [] });
    let steps = [];
    try {
      const app = await buildApp({ prompt: request, source: base?.app ?? null }, (event) => {
        if (event.type === "plan") steps = event.steps;
        setJob((state) => ({
          ...state,
          stage: event.type === "stage" ? event.stage : state.stage,
          steps,
        }));
      });
      setJob({ turnId: turn.id, stage: "previewing", steps });
      setCandidate({ projectId: target.id, turnId: turn.id, app, steps, frame: createFrame(app) });
    } catch (error) {
      const message = error.name === "TimeoutError" ? "智能体响应超时，可以重试这条需求。" : error.message;
      setProjects((all) => all.map((item) => item.id !== target.id ? item : {
        ...item,
        turns: item.turns.map((entry) => entry.id === turn.id ? { ...entry, steps, error: message } : entry),
      }));
      pending.current = false;
      setJob(null);
    }
  }

  function submit(request) {
    if (pending.current || projects === null) return;
    let target = project;
    if (!target) {
      target = { id: crypto.randomUUID(), turns: [], versions: [] };
      setProjects((all) => [target, ...all]);
      selectProject(target.id);
    } else {
      setPrompt("");
    }
    void runBuild(target, request);
  }

  function restore(version) {
    if (pending.current || !isHistorical) return;
    const id = crypto.randomUUID();
    setProjects((all) => all.map((item) => (
      item.id !== project.id ? item : {
        ...item,
        versions: [...item.versions, { ...version, id, number: item.versions.length + 1, restoredFrom: version.number }],
      }
    )));
    setShownId(null);
  }

  return (
    <div className="shell">
      <header className="header">
        <button className="brand" type="button" onClick={() => selectProject(null)} disabled={Boolean(job)}>
          <span className="brand-mark" aria-hidden="true">✳</span> Atoms Demo
        </button>
        {project && <span className="project-name">{current?.app.title ?? "新应用"}</span>}
        {project && (
          <button className="quiet-button" type="button" onClick={() => setHistory((open) => !open)} aria-expanded={history}>
            版本历史
          </button>
        )}
      </header>
      {storageError && <p className="storage-error" role="alert">浏览器暂时无法保存项目。刷新前请保留所需源码。</p>}

      {!project ? (
        <main className="home">
          <div className="intro">
            <h1>把想法变成<br />可用的网页应用<span>。</span></h1>
            <p>描述你想做的事，跟随智能体的构建计划，在预览里试用和修改。</p>
          </div>
          <PromptForm value={prompt} onChange={setPrompt} onSubmit={submit} disabled={projects === null}
            label="生成应用" placeholder="你想做什么？描述用途、主要功能和喜欢的样式。" focusRef={homeInput} primary />
          <div className="examples" aria-label="填写示例需求">
            <span>试试这些想法</span>
            {examples.map((example) => (
              <button key={example.label} type="button" onClick={() => { setPrompt(example.prompt); homeInput.current?.focus(); }}>
                {example.label}
              </button>
            ))}
          </div>
          {projects?.length > 0 && (
            <section className="recent" aria-label="最近项目">
              <h2>最近项目</h2>
              {projects.map((item) => (
                <button key={item.id} className="quiet-button" type="button" onClick={() => selectProject(item.id)}>
                  {item.versions.at(-1)?.app.title ?? item.turns[0]?.prompt.slice(0, 32) ?? "新应用"}
                </button>
              ))}
            </section>
          )}
        </main>
      ) : (
        <main className="workspace">
          <aside className="conversation" aria-label="构建对话">
            <h1>项目对话</h1>
            <div className="thread">
              {project.turns.map((turn) => {
                const running = job?.turnId === turn.id;
                const steps = running ? job.steps : turn.steps;
                const version = project.versions.find((item) => item.id === turn.id);
                const base = project.versions.find((item) => item.id === turn.baseId);
                return (
                  <section className="turn" key={turn.id}>
                    <article className="request">
                      <h2>{base ? `你的需求 · 基于 v${base.number}` : "你的需求"}</h2>
                      <p>{turn.prompt}</p>
                    </article>
                    {steps?.length > 0 && (
                      <details className="build-plan" open={running || undefined}>
                        <summary>智能体的构建计划</summary>
                        <ol>{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
                      </details>
                    )}
                    {running && (
                      <div className="activity" role="status">
                        <span className="spinner" aria-hidden="true" />{stageText[job.stage]}
                      </div>
                    )}
                    {!running && !turn.complete && (
                      <div className="failure">
                        <p role="alert">{turn.error || "这次构建已中断。"}</p>
                        <button className="quiet-button" type="button" disabled={Boolean(job)} onClick={() => void runBuild(project, turn.prompt, turn)}>重试</button>
                      </div>
                    )}
                    {version && (
                      <article className="version">
                        <h2>v{version.number} · {version.app.title}</h2>
                        <p>{version.app.summary}</p>
                        <VersionAcceptance results={version.acceptance} />
                        <button className="quiet-button" type="button" onClick={() => { setShownId(version.id); setTab("preview"); }}>
                          预览 v{version.number}
                        </button>
                      </article>
                    )}
                  </section>
                );
              })}
              <div ref={logEnd} />
            </div>
            <PromptForm value={prompt} onChange={setPrompt} onSubmit={submit} disabled={Boolean(job) || isHistorical}
              label={current ? "发送修改" : "生成应用"} placeholder={isHistorical ? "恢复此版本后可继续修改" : current ? "告诉智能体你想修改什么" : "描述你想构建的应用"} />
          </aside>
          <section className="output" aria-label="应用输出">
            <div className="toolbar">
              <div className="segments" aria-label="输出视图">
                <button type="button" aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>预览</button>
                <button type="button" aria-pressed={tab === "code"} disabled={!shown} onClick={() => setTab("code")}>源码</button>
              </div>
              {shown && (
                <div className="view-actions">
                  <span className="version-label">{isHistorical ? `查看 v${shown.number} · 当前 v${current.number}` : `当前版本 v${shown.number}`}</span>
                  {isHistorical ? (
                    <>
                      <button className="quiet-button" type="button" onClick={() => setShownId(null)}>返回当前版</button>
                      <button className="quiet-button" type="button" disabled={Boolean(job)} onClick={() => restore(shown)}>恢复此版本</button>
                    </>
                  ) : tab === "preview" && (
                    <button className="quiet-button" type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button>
                  )}
                </div>
              )}
            </div>
            {history && (
              <section className="history-list" aria-label="版本历史列表">
                {project.versions.length ? [...project.versions].reverse().map((version) => (
                  <button key={version.id} className="quiet-button" type="button" aria-pressed={shown?.id === version.id}
                    onClick={() => { setShownId(version.id); setTab("preview"); }}>
                    v{version.number} · {version.restoredFrom ? `恢复自 v${version.restoredFrom}` : version.app.title}
                  </button>
                )) : <p>构建完成后，版本会出现在这里。</p>}
              </section>
            )}
            {previewError && tab === "preview" && <p className="preview-error" role="alert">预览异常 · {previewError}</p>}
            {!shown && (
              <div className="empty-preview">
                <strong>{job ? "正在构建你的应用" : "等待应用版本"}</strong>
                <p>构建完成后，可以在这里直接操作。</p>
              </div>
            )}
            {shown && activeFrame && (
              <div className="canvas" hidden={tab !== "preview"}>
                <iframe key={activeFrame.token} ref={liveFrame} srcDoc={activeFrame.source}
                  sandbox={previewSandbox} referrerPolicy="no-referrer" title={shown.app.title + "应用预览"} />
              </div>
            )}
            {tab === "code" && shown && (
              <div className="source">
                {[["HTML", shown.app.html], ["CSS", shown.app.css], ["JavaScript", shown.app.js]].map(([label, code]) => (
                  <section key={label}><h2>{label}</h2><pre><code>{code}</code></pre></section>
                ))}
              </div>
            )}
            {candidate && (
              <iframe key={candidate.frame.token} className="candidate-frame" ref={candidateFrame} srcDoc={candidate.frame.source}
                aria-hidden="true" tabIndex={-1} sandbox={previewSandbox} referrerPolicy="no-referrer" title={candidate.acceptance ? "交互检查" : "启动检查"} />
            )}
          </section>
        </main>
      )}
    </div>
  );
}

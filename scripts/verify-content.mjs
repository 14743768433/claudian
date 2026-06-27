#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const args = parseArgs(process.argv.slice(2));
const benchmarkRoot = path.resolve(process.cwd(), args.benchmark);
const candidateRoot = args.candidates
  ? path.resolve(process.cwd(), args.candidates)
  : null;
const reportPath = path.resolve(process.cwd(), args.report);
const skillPath = path.resolve(process.cwd(), args.skill);
const historyDir = path.resolve(process.cwd(), args.history);
const dimensions = [
  "narrativeDepth",
  "structureClarity",
  "visualAids",
  "practicality",
  "explanationDepth",
  "assessmentLoop",
  "sourceGrounding",
  "voiceSharpness",
];
const skill = readSkillMetadata(skillPath);

if (args.blindCommand) {
  runBlindCommand(args.blindCommand, args.candidates);
}

const benchmark = scoreGroup("benchmark", benchmarkRoot, args.threshold);
const candidates =
  candidateRoot && fs.existsSync(candidateRoot)
    ? scoreGroup("candidate", candidateRoot, args.threshold)
    : null;
const failed = candidates
  ? strictCandidateFailures(candidates, args)
  : thresholdFailures(benchmark, args.threshold);
const stability = candidates
  ? evaluateStability(historyDir, args, skill, {
      generatedAt: new Date().toISOString(),
      candidates,
    })
  : null;

if (stability?.status === "failed") {
  failed.push(
    ...stability.failures.map((reason) => ({
      group: "stability",
      file: "*",
      reason,
    }))
  );
} else if (stability?.status === "pending" && args.requireStability) {
  failed.push({
    group: "stability",
    file: "*",
    reason: stability.reason,
  });
}

const output = {
  generatedAt: stability?.current.generatedAt || new Date().toISOString(),
  skill,
  runner: {
    blindCommand: args.blindCommand,
    benchmarkRoot,
    candidateRoot,
  },
  passThreshold: args.threshold,
  strictCandidateGate: candidates
    ? {
        minOverall: args.candidateMinOverall,
        minAverage: args.candidateMinAverage,
        dimensionFloor: args.dimensionFloor,
      }
    : null,
  dimensions,
  benchmark,
  candidates,
  comparison: candidates
    ? {
        averageGap: round1(candidates.averageOverall - benchmark.averageOverall),
        benchmarkAverage: benchmark.averageOverall,
        candidateAverage: candidates.averageOverall,
      }
    : null,
  stability,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
if (args.recordHistory && candidates && failed.length === 0) {
  writeHistoryReport(historyDir, output);
}

console.log(JSON.stringify(output, null, 2));

if (failed.length > 0) {
  console.error(
    `Content verification failed: ${failed.length} file(s) below threshold. Report: ${reportPath}`
  );
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    benchmark: path.join("tests", "golden", "heptabase"),
    candidates: path.join("tests", "golden", "blind-candidates"),
    report: path.join("tests", "golden", "report.json"),
    threshold: 6.5,
    candidateMinOverall: 8,
    candidateMinAverage: 8.5,
    dimensionFloor: 6.5,
    blindCommand: null,
    skill: path.join("skills", "lesson-page-generation", "SKILL.md"),
    history: path.join("tests", "golden", "history"),
    recordHistory: false,
    requireStability: false,
    stableVersions: 2,
    maxRegression: 0,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--benchmark") {
      options.benchmark = argv[++index];
    } else if (arg === "--candidates") {
      options.candidates = argv[++index];
    } else if (arg === "--report") {
      options.report = argv[++index];
    } else if (arg === "--threshold") {
      options.threshold = Number(argv[++index]);
    } else if (arg === "--candidate-min-overall") {
      options.candidateMinOverall = Number(argv[++index]);
    } else if (arg === "--candidate-min-average") {
      options.candidateMinAverage = Number(argv[++index]);
    } else if (arg === "--dimension-floor") {
      options.dimensionFloor = Number(argv[++index]);
    } else if (arg === "--blind-command") {
      options.blindCommand = argv[++index];
    } else if (arg === "--skill") {
      options.skill = argv[++index];
    } else if (arg === "--history") {
      options.history = argv[++index];
    } else if (arg === "--record-history") {
      options.recordHistory = true;
    } else if (arg === "--require-stability") {
      options.requireStability = true;
    } else if (arg === "--stable-versions") {
      options.stableVersions = Number(argv[++index]);
    } else if (arg === "--max-regression") {
      options.maxRegression = Number(argv[++index]);
    } else if (arg === "--no-candidates") {
      options.candidates = null;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    options.benchmark = positional[0];
    if (positional[1]) options.candidates = positional[1];
  }

  return options;
}

function readSkillMetadata(filePath) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  return {
    path: filePath,
    hash: sha256(content),
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function thresholdFailures(group, threshold) {
  return group.files
    .filter((report) => report.overall < threshold)
    .map((report) => ({
      group: group.kind,
      file: report.file,
      reason: `overall ${report.overall} < ${threshold}`,
    }));
}

function strictCandidateFailures(group, options) {
  const failures = [];
  if (group.averageOverall < options.candidateMinAverage) {
    failures.push({
      group: group.kind,
      file: "*",
      reason: `average ${group.averageOverall} < ${options.candidateMinAverage}`,
    });
  }

  for (const report of group.files) {
    if (report.overall < options.candidateMinOverall) {
      failures.push({
        group: group.kind,
        file: report.file,
        reason: `overall ${report.overall} < ${options.candidateMinOverall}`,
      });
    }

    for (const [dimension, result] of Object.entries(report.checks)) {
      if (result.score < options.dimensionFloor) {
        failures.push({
          group: group.kind,
          file: report.file,
          reason: `${dimension} ${result.score} < ${options.dimensionFloor}`,
        });
      }
    }
  }

  return failures;
}

function runBlindCommand(command, candidatesDir) {
  if (!candidatesDir) return;
  const outputDir = path.resolve(process.cwd(), candidatesDir);
  cleanGeneratedCandidates(outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  execFileSync(command, {
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      AI_TUTOR_BLIND_OUTPUT_DIR: outputDir,
      AI_TUTOR_LESSON_SKILL: path.resolve(
        process.cwd(),
        "skills",
        "lesson-page-generation",
        "SKILL.md"
      ),
    },
  });
}

function cleanGeneratedCandidates(outputDir) {
  const goldenRoot = path.resolve(process.cwd(), "tests", "golden");
  const relative = path.relative(goldenRoot, outputDir);
  const isSafeGeneratedDir =
    relative &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative);

  if (!isSafeGeneratedDir || !fs.existsSync(outputDir)) return;

  const stack = [outputDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.endsWith(".md")) {
        fs.unlinkSync(fullPath);
      }
    }
  }
}

function evaluateStability(historyDir, options, skill, current) {
  const history = readHistoryReports(historyDir)
    .filter((report) => report.skill?.hash && report.candidates)
    .map((report) => summarizeVersion(report, options));

  const currentSummary = summarizeVersion(
    {
      generatedAt: current.generatedAt,
      skill,
      candidates: current.candidates,
    },
    options
  );

  const byHash = new Map();
  for (const item of [...history, currentSummary]) {
    const previous = byHash.get(item.skillHash);
    if (!previous || new Date(item.generatedAt) >= new Date(previous.generatedAt)) {
      byHash.set(item.skillHash, item);
    }
  }

  const versions = Array.from(byHash.values()).sort(
    (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime()
  );
  const recent = versions.slice(-options.stableVersions);

  if (recent.length < options.stableVersions) {
    return {
      status: "pending",
      reason: `need ${options.stableVersions} distinct skill versions, found ${recent.length}`,
      requiredVersions: options.stableVersions,
      distinctVersionsFound: recent.length,
      maxRegression: options.maxRegression,
      current: currentSummary,
      versions: recent,
      failures: [],
    };
  }

  const failures = [];
  for (const version of recent) {
    if (!version.strictCandidateGatePassed) {
      failures.push(`skill ${version.skillHash.slice(0, 12)} did not pass strict candidate gate`);
    }
  }

  for (let index = 1; index < recent.length; index++) {
    const previous = recent[index - 1];
    const next = recent[index];
    if (next.candidateAverage + options.maxRegression < previous.candidateAverage) {
      failures.push(
        `candidate average regressed ${previous.candidateAverage} -> ${next.candidateAverage}`
      );
    }

    for (const dimension of dimensions) {
      const before = previous.dimensionAverages[dimension] ?? 0;
      const after = next.dimensionAverages[dimension] ?? 0;
      if (after + options.maxRegression < before) {
        failures.push(`${dimension} regressed ${before} -> ${after}`);
      }
    }
  }

  return {
    status: failures.length > 0 ? "failed" : "passed",
    reason:
      failures.length > 0
        ? `${failures.length} stability regression(s) found`
        : `${recent.length} consecutive skill versions passed with no regression`,
    requiredVersions: options.stableVersions,
    distinctVersionsFound: recent.length,
    maxRegression: options.maxRegression,
    current: currentSummary,
    versions: recent,
    failures,
  };
}

function readHistoryReports(historyDir) {
  if (!fs.existsSync(historyDir)) return [];
  const reports = [];
  for (const file of fs.readdirSync(historyDir)) {
    if (!file.endsWith(".json")) continue;
    const fullPath = path.join(historyDir, file);
    try {
      reports.push(JSON.parse(fs.readFileSync(fullPath, "utf8")));
    } catch {
      // Ignore malformed historical reports; the current run remains authoritative.
    }
  }
  return reports;
}

function summarizeVersion(report, options) {
  const failures = report.candidates
    ? strictCandidateFailures(report.candidates, options)
    : [{ reason: "missing candidates" }];

  return {
    generatedAt: report.generatedAt,
    skillHash: report.skill.hash,
    skillBytes: report.skill.bytes,
    candidateAverage: report.candidates?.averageOverall ?? 0,
    dimensionAverages: report.candidates
      ? averageDimensions(report.candidates)
      : Object.fromEntries(dimensions.map((dimension) => [dimension, 0])),
    strictCandidateGatePassed: failures.length === 0,
  };
}

function averageDimensions(group) {
  return Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      round1(
        averageScore(
          group.files.map((report) => report.checks?.[dimension]?.score ?? 0)
        )
      ),
    ])
  );
}

function writeHistoryReport(historyDir, output) {
  fs.mkdirSync(historyDir, { recursive: true });
  const candidateName = output.runner.candidateRoot
    ? path.basename(output.runner.candidateRoot)
    : "candidate";
  const fileName = `${sanitizeFilePart(candidateName)}-${output.skill.hash.slice(0, 12)}.json`;
  fs.writeFileSync(path.join(historyDir, fileName), `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function sanitizeFilePart(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "candidate";
}

function scoreGroup(kind, root, threshold) {
  const files = collectMarkdownFiles(root);
  if (files.length === 0) {
    console.error(`No markdown files found under ${root}`);
    process.exit(1);
  }

  const reports = files.map((file) => scoreFile(file, root));
  return {
    kind,
    target: root,
    fileCount: reports.length,
    averageOverall: round1(averageScore(reports.map((report) => report.overall))),
    passThreshold: threshold,
    files: reports,
  };
}

function collectMarkdownFiles(targetPath) {
  if (!fs.existsSync(targetPath)) return [];
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return targetPath.endsWith(".md") ? [targetPath] : [];

  const results = [];
  const stack = [targetPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const isCoursePart = /part-\d+-.+\.md$/i.test(entry.name);
        const isGolden = fullPath.includes(`${path.sep}tests${path.sep}golden${path.sep}`);
        if (isCoursePart || isGolden) results.push(fullPath);
      }
    }
  }
  return results.sort();
}

function scoreFile(file, basePath) {
  const raw = fs.readFileSync(file, "utf8");
  const content = stripFrontmatter(raw);
  const checks = {
    narrativeDepth: scoreNarrativeDepth(content),
    structureClarity: scoreStructure(content),
    visualAids: scoreVisualAids(content),
    practicality: scorePracticality(content),
    explanationDepth: scoreExplanationDepth(content),
    assessmentLoop: scoreAssessmentLoop(content),
    sourceGrounding: scoreSourceGrounding(content),
    voiceSharpness: scoreVoiceSharpness(content),
  };
  const gaps = Object.entries(checks)
    .filter(([, value]) => value.score < 6.5)
    .map(([name, value]) => `${name}: ${value.reason}`);

  return {
    file: path.relative(basePath, file).replace(/\\/g, "/"),
    overall: round1(averageScore(Object.values(checks).map((item) => item.score))),
    checks,
    gaps,
  };
}

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\s*/, "").trim();
}

function scoreNarrativeDepth(content) {
  const chars = plainText(content).length;
  const paragraphs = content.split(/\n\s*\n/).filter((item) => item.trim().length > 80);
  const score = clamp((chars / 1200) * 5 + Math.min(paragraphs.length, 8) * 0.65);
  return {
    score,
    reason: `${chars} chars and ${paragraphs.length} substantial paragraphs`,
  };
}

function scoreStructure(content) {
  const h2 = (content.match(/^##\s+/gm) || []).length;
  const h3 = (content.match(/^###\s+/gm) || []).length;
  const score = clamp(Math.min(h2, 5) * 1.2 + Math.min(h3, 8) * 0.45 + 2);
  return {
    score,
    reason: `${h2} h2 headings and ${h3} h3 headings`,
  };
}

function scoreVisualAids(content) {
  const mermaid = /```mermaid/i.test(content);
  const code = /```(?!mermaid)[a-z0-9_-]+/i.test(content);
  const table = /\|.+\|[\s\S]*?\|[-:\s|]+\|/.test(content);
  const image = /!\[\[.+?\]\]|!\[.*?]\(.+?\)/.test(content);
  const signals = [mermaid, code, table, image].filter(Boolean).length;
  // Two complementary aids (e.g. a diagram + a table) is full credit. Piling on
  // a third/fourth aid no longer inflates the score, so pages are not pushed to
  // mechanically stuff every page with mermaid + table + code. A prose-only page
  // is acceptable (the Heptabase reference is itself prose-first), so the no-aid
  // baseline is "passing but unenhanced", not near-failing.
  const score = signals === 0 ? 6 : clamp(6.4 + Math.min(signals, 2) * 1.4);
  return {
    score,
    reason:
      signals === 0
        ? "prose-only (acceptable, no enhancing aid)"
        : `${signals} visual aid signals (credited up to 2)`,
  };
}

function scorePracticality(content) {
  const patterns = [
    /step|步骤|流程|实践|练习|运行|配置|实现|案例|项目|代码|命令|调试/i,
    /\b\d+\.\s+/,
    /```/,
  ];
  const hits = patterns.filter((pattern) => pattern.test(content)).length;
  const score = clamp(4.5 + hits * 1.8);
  return {
    score,
    reason: `${hits} practice signals`,
  };
}

function scoreExplanationDepth(content) {
  const matches = content.match(/为什么|因为|因此|所以|本质|意味着|原因|why|because|therefore/gi) || [];
  const score = clamp(4 + Math.min(matches.length, 12) * 0.55);
  return {
    score,
    reason: `${matches.length} causal/explanatory markers`,
  };
}

function scoreAssessmentLoop(content) {
  const matches = content.match(/quiz|review|复习|问题|练习|测验|检查|总结|回顾/gi) || [];
  const score = clamp(4 + Math.min(matches.length, 10) * 0.6);
  return {
    score,
    reason: `${matches.length} review or assessment markers`,
  };
}

function scoreSourceGrounding(content) {
  const sourceBlocks = (content.match(/\[Source block\]/g) || []).length;
  const citations = (content.match(/\[\d+\]/g) || []).length;
  const score = clamp(4 + Math.min(sourceBlocks, 3) * 1.2 + Math.min(citations, 12) * 0.25);
  return {
    score,
    reason: `${sourceBlocks} source blocks and ${citations} citation markers`,
  };
}

function scoreVoiceSharpness(content) {
  const prose = plainText(content);
  // "Voice / 锐度": memorable, human writing — analogies, concrete figures,
  // conversational empathy — minus generic AI-slop connectives. This is a
  // deterministic proxy; the LLM judge (verify:content:llm) measures it better.
  const analogies = (
    content.match(
      /就像|像是|好像|好比|相当于|如同|想象|仿佛|犹如|宛如|打个比方|类比|想成|看成|当成|称为|称作|号称|堪称|无异于/g
    ) || []
  ).length;
  const figures = (prose.match(/\d+/g) || []).length;
  const voice = (
    content.match(
      /你会发现|你可能|别担心|别急|不用怕|焦虑|其实|说白了|坦白说|想象一下|站到|脱口而出|眼前一亮|主心骨|你只要|记住|别看/g
    ) || []
  ).length;
  const slop = (
    content.match(
      /首先|其次|再次|综上所述|总而言之|众所周知|一般来说|总的来说|不难看出|值得注意的是|总的来看/g
    ) || []
  ).length;
  const score = clamp(
    3.2 +
      Math.min(analogies, 3) * 0.85 +
      Math.min(figures, 10) * 0.13 +
      Math.min(voice, 5) * 0.42 -
      Math.min(slop, 6) * 0.8
  );
  return {
    score,
    reason: `${analogies} analogies, ${figures} concrete figures, ${voice} voice markers, ${slop} slop phrases`,
  };
}

function plainText(content) {
  return content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[\[.+?\]\]|!\[.*?]\(.+?\)/g, "")
    .replace(/[#>*_`|[\]()]/g, "")
    .trim();
}

function averageScore(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value) {
  return round1(Math.max(0, Math.min(10, value)));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

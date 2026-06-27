#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const outputDir =
  process.argv[2] ||
  process.env.AI_TUTOR_BLIND_OUTPUT_DIR ||
  path.join("tests", "golden", "blind-candidates");
const out = path.resolve(process.cwd(), outputDir);
fs.mkdirSync(out, { recursive: true });

const content = `# 从采样窗口到故障判断：Linux AI 项目的第一条闭环

你坐在实验台前，开发板已经启动，串口里以每秒 50000 次的速度不断刷出传感器采样值。第一次看到这种数据洪流，焦虑很正常——别担心，真正的问题不是“模型能不能跑”，而是这些数字怎样一步步变成一个可靠的判断：轴承是不是异常，锅炉火焰是不是稳定，系统该不该提醒现场人员停下来检查。

这一页只处理一个小窗口：从一段输入数据进入 Linux 端程序，到系统输出一次诊断结果。它不试图讲完整门课，因为一节课最重要的工作，是把一条链路彻底看清楚，而不是把十条链路看个模糊。

## 为什么先看闭环

很多 AI 项目失败，并不是因为模型结构太简单，而是因为训练、导出、部署和现场数据之间没有闭合[1]。这就像盖楼时四面墙各砌各的、最后合不上缝——训练脚本里看到的是规整的样本，Linux 端拿到的却是带噪声、时序抖动、甚至偶发丢包的数据[2]。因此，我们先把“输入窗口 -> 预处理 -> 推理 -> 后处理 -> 记录结果”这条线走通。

记住一句话：链路通了，问题才有地方落脚。你会发现，采样频率不稳就查输入窗口；准确率下降就查预处理和模型版本；现场误报多就查后处理阈值——每一种症状，都能在这条闭环上找到唯一的体检点。

\`\`\`mermaid
flowchart LR
  A[采样窗口] --> B[预处理]
  B --> C[模型推理]
  C --> D[阈值与规则]
  D --> E[诊断结果]
  E --> F[日志与回放]
\`\`\`

## 一个可检查的窗口

把输入想成一个固定长度的窗口，而不是一条无限长的数据流。窗口的好处是它让系统拥有稳定边界：每次推理都知道自己用了哪些数据，也方便在日志里回放。

| 环节 | 需要记录什么 | 为什么 |
| --- | --- | --- |
| 采样 | 开始时间、窗口长度、通道数 | 复现输入范围 |
| 预处理 | 归一化参数、滤波配置 | 避免训练和部署不一致 |
| 推理 | 模型版本、输出向量 | 追踪模型变化 |
| 后处理 | 阈值、规则命中项 | 解释最终判断 |

这张表的价值不是文档好看，而是让调试有抓手。假如现场说“昨天误报很多”，你不需要先猜模型坏了，而是能沿着这些记录逐项排查。

## 最小实现思路

在代码层面，可以先把推理主循环写成三个明确函数。这样做不是为了抽象，而是为了让每一步都能单独测试。

\`\`\`cpp
SampleWindow window = read_window(device, 2048);
Tensor input = preprocess(window, norm_config);
Prediction pred = run_model(model, input);
Decision decision = apply_rules(pred, threshold_config);
write_diagnosis_log(window.meta, pred, decision);
\`\`\`

如果这段流程在 PC 端和 Linux 端都能用同一组 fixture 跑通，说明训练导出和部署之间至少没有明显断层[3]。接下来再讨论模型结构、速度优化或 UI 展示，才不会漂在空中[4]。

## 检查题

1. 为什么现场误报不能第一时间归因于模型结构？
2. 如果训练端和 Linux 端使用了不同归一化参数，会出现什么后果？
3. 你会在诊断日志里至少记录哪三类信息？

## Review

这一节的核心不是“写完 AI 推理代码”，而是建立可回放、可解释、可调试的一次诊断闭环。下一节可以继续拆开预处理，看看振动信号和图像帧为什么需要不同的数据整理方式。

[Source block] 本页作为盲测候选，不读取 Heptabase golden，只使用课程 spec 中的页面质量约束。[5]

[Source block] 引用编号用于验证 source-grounding 结构，不代表外部资料逐字摘录。[6]
`;

fs.writeFileSync(path.join(out, "linux-ai-pipeline.md"), content, "utf8");
console.log(`Blind candidate written to ${out}`);

# QQ 解耦：runCommand 依赖清单

runCommand 目前引用 gate 内部函数（必须显式传入才能搬走）：

- say
- runDraw
- psRun
- ensureVoiceService

抽取顺序：
1. 把上述依赖收进一个 deps 对象（say/发消息/画图/语音/内存/支付/群管）
2. runCommand 改成 createCommandRunner(deps)，返回 { runCommand }
3. gate 调用处只传 deps，不再让命令直接抓闭包
4. 每步跑 p05 / natural / p14 / 全量，绿了提交

未完成：群管额度、gate 主循环仍与 gate 状态绑定，最后搬。

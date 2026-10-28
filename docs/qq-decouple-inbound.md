# QQ 解耦：主循环（onInbound）依赖清单

gate 内部函数依赖：

- parseRaw
- replyTargetOf
- handleBind
- say
- runDraw
- psRun
- ensureVoiceService
- doDraw

主循环还依赖 createGate 的运行时状态（bot/diag/计数器/定时器），需要把这些先抽成显式 ctx，才能整体搬出。

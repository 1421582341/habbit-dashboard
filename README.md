# INFPLife · 精灵看板 🧚

日常习惯追踪 + 精灵收集 + 经验值等级系统

## 功能

- ✅ 每日习惯打卡
- 💧 喝水追踪
- ⚖️ 体重记录
- 🧚 精灵图鉴（像素风，拓麻歌子式喂养）
- 🪙 金币商店 + 喂食升级
- 📊 EXP 经验值 + 称号系统（每10级一个称号）
- 🌙 深色模式

## 本地运行

```bash
cd habit-dashboard
python3 -m http.server 8080
```

然后用 Serveo 隧道暴露到公网：
```bash
ssh -R 80:localhost:8080 serveo.net
```

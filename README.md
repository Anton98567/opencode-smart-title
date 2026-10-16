# opencode-smart-title

Локальный форк плагина авто-названий сессий для [opencode](https://opencode.ai)
(`@hyakt/opencode-smart-title` 0.1.10, форк `Tarquinen/opencode-smart-title`).

Генерирует осмысленный заголовок сессии по содержимому диалога — работает на
языке разговора (русский/английский) и на любой модели текущей сессии.

## Почему форк

* Оригинал `@tarquinen/opencode-smart-title` зовёт LLM напрямую через `ai@5`
  (spec v2), opencode 1.18+ отдаёт модели spec v4 → `Unsupported model version v4`.
* Форк `@hyakt` делает запрос через subagent-сессию самого opencode
  (`session.create` + `session.prompt`) — совместимо с актуальными версиями.

## Локальные патчи (см. PATCHES.md)

1. **Язык заголовка** — промпт берёт язык из диалога, технические термины
   не переводятся (детект кириллицы + метка `<detected_language>`).
2. **Модель из текущей сессии** — вместо жёстко заданной модели:
   конфиг → модель сессии → default, с перебором при сбое.
3. **Таймаут и очистка** — `session.prompt` ограничен 45 с, при зависании
   дочерняя сессия абортится и удаляется; защита от параллельных дублей.

## Установка

```jsonc
// ~/.config/opencode/opencode.json
{
  "plugin": ["file:///path/to/opencode-smart-title/dist/index.js"],
  "agent": { "title": { "disable": true } }  // отключить встроенный title-агент
}
```

## Конфиг

`~/.config/opencode/smart-title.jsonc`:

```jsonc
{
  "enabled": true,
  "debug": false,          // логи: ~/.config/opencode/logs/smart-title/
  "model": "current",      // "current" | "provider/model"
  "updateThreshold": 1     // обновлять каждые N idle-событий
}
```

## Требования

* opencode ≥ 1.18 (проверено на 1.19.0)
* работает с любой моделью, настроенной в сессии

## Лицензия

См. LICENSE.

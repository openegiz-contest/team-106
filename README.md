# team-106: Цифровой двойник открытого карьера на OpenEgiz

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenEgiz](https://img.shields.io/badge/Platform-OpenEgiz%20v1.0.4-orange)](https://openegiz.kz/)
[![Status](https://img.shields.io/badge/Status-Submission%20Ready-green)]()

Конкурсный проект команды **team-106** (`@adixssc`) для соревнования [«Цифровой рудник на OpenEgiz»](https://openegiz-contest.github.io/ru/).

Решение реализует полнофункциональный цифровой двойник добычного участка открытого медно-порфирового карьера, связывающий геологическую блочную модель уступов с физически достоверной диспетчеризацией карьерного автотранспорта (БелАЗ-75131 и ЭКГ-15) и автоматической стабилизацией качества рудной смеси (шихты) на перерабатывающей фабрике.

---

## Быстрый запуск решения (Инструкция для ИИ-жюри)

В соответствии с регламентом [Окружения судьи](https://openegiz-contest.github.io/ru/environment/), всё решение разворачивается автоматически с нуля **одной командой** без ручных манипуляций и внешних API-ключей:

```bash
docker compose up -d --build
```

*Время первой сборки и старта: менее 2 минут на чистой Ubuntu 24.04 LTS.*

### Автоматическая самопроверка (Smoke Test)
Для быстрой автоматической валидации всех сервисов, цифровых двойников и сценариев запустите скрипт проверки:

```bash
bash scripts/smoke_test.sh
```

---

## Карта сервисов и точек входа

Все веб-интерфейсы и порты доступны локально сразу после старта контейнеров:

| Сервис | URL | Назначение и функции | Учётные данные |
| :--- | :--- | :--- | :--- |
| **3D/ГИС Центр управления** | [http://localhost:8080](http://localhost:8080) | Интерактивная 3D-сцена карьера на Three.js/WebGL: движение самосвалов в реальном времени, картограмма качества блоков, инспектор двойников, пульт What-If сценариев и встроенный аналитический дашборд смены (с экспортом в CSV) | Не требуются (открытый доступ) |
| **Аналитические дашборды Grafana** | [http://localhost:3000](http://localhost:3000) | Живой дашборд «OpenEgiz Digital Mine: Шихтовка и Диспетчеризация» с временными рядами из InfluxDB (автопровижининг) | Анонимный доступ (Admin) |
| **API цифровых двойников Eclipse Ditto** | [http://localhost:8080/api/2/things](http://localhost:8080/api/2/things) | REST API иерархии цифровых двойников карьера (`mine:mine-01`, `mine:truck-*`, `mine:excavator-*`, `mine:block-*`) | `ditto` / `ditto` |
| **API симулятора и сценариев «Что если»** | [http://localhost:8000/docs](http://localhost:8000/docs) | Swagger OpenAPI симулятора физики, потока телеметрии и эндпоинтов управления сценариями | Не требуются |
| **База временных рядов InfluxDB v2** | [http://localhost:8086](http://localhost:8086) | Прямой доступ к хранилищу телеметрии (организация `opentwins`, бакет `default`) | `admin` / `adminpassword123` |
| **Брокер сообщений Mosquitto (MQTT)** | `localhost:1883` | Шина потоковой телеметрии реального времени (топики `telemetry/#` и `opentwins/#`) | Анонимный доступ |

---

## Инженерные сценарии «Что если» (What-If Analysis)

Переключать сценарии можно интерактивно через кнопки в нижней панели [3D-визуализатора](http://localhost:8080) либо отправкой REST API запросов:

### 1. Внеплановая аварийная остановка экскаватора в богатом забое
Эмулирует отказ экскаватора ЭКГ-01 (горизонт 420м, содержание Cu 1.65%). Самосвалы автоматически перенаправляются на резервные забои:
```bash
curl -X POST http://localhost:8000/api/scenario/excavator-failure \
  -H "Content-Type: application/json" \
  -d '{"excavator_id": "excavator-01"}'
```

### 2. Переключение режима диспетчеризации (Шихтовка vs Максимум тоннажа)
Переключает алгоритм между стабилизацией целевого содержания меди (1.05% Cu) и жадной минимизацией очередей:
```bash
curl -X POST http://localhost:8000/api/scenario/dispatch-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "MAX_TONNAGE"}'
```
*(Для возврата к шихтовке передайте `{"mode": "QUALITY_BLEND"}`)*.

### 3. Ухудшение дорожных условий (Гололёд на главном съезде)
Снижает допустимую скорость на внутрикарьерных съездах с уклоном 9% на 45%, увеличивая цикл рейса и очереди:
```bash
curl -X POST http://localhost:8000/api/scenario/road-condition \
  -H "Content-Type: application/json" \
  -d '{"condition": "slippery_ice", "speed_factor": 0.55}'
```

### 4. Сброс в штатный режим
Возвращает все объекты в нормальное исходное состояние:
```bash
curl -X POST http://localhost:8000/api/scenario/reset
```

---

## Архитектура решения и структура репозитория

```
.
├── docker-compose.yml            # Полная оркестрация OpenEgiz (Ditto, InfluxDB, Mosquitto, Grafana, Simulator, 3D WebGL)
├── README.md                     # Данная инструкция развертывания
├── SUBMISSION.md                 # Полное конкурсное описание решения для ИИ-жюри
├── presentation.pdf              # Официальная презентация решения (9 слайдов)
├── LICENSE                       # Лицензия MIT
├── data/
│   ├── mine_map.geojson          # 3D-геометрия уступов, забоев, съездов и пунктов разгрузки
│   └── ore_blocks.json           # 8 добычных блоков (тоннаж, содержание Cu/Fe, крепость пород)
├── simulator/
│   ├── Dockerfile                # Контейнер симулятора (Python 3.12 slim)
│   ├── requirements.txt
│   ├── config.py                 # Конфигурация брокера, Ditto и InfluxDB
│   ├── physics_engine.py         # Физика тяги БелАЗ-75131 на уклонах (8-10%), скорости 12-18 км/ч, погрузка ЭКГ-15
│   ├── dispatcher.py             # Алгоритмы шихтовки руды, диспетчеризации и сценариев «что если»
│   ├── ditto_bootstrap.py        # Автоматическая инициализация Things & Policies в Eclipse Ditto
│   └── main.py                   # FastAPI сервер + фоновый цикл публикации телеметрии в MQTT
├── visualizer/
│   ├── Dockerfile                # Nginx контейнер 3D/ГИС-центра управления
│   ├── nginx.conf                # Проксирование WebGL, Ditto API и Simulator API
│   ├── index.html                # Интерактивная веб-панель оператора
│   ├── app.js                    # Three.js 3D-сцена карьера, трекинг самосвалов и спарклайны
│   └── style.css                 # Премиальный дизайн центра управления
├── config/
│   ├── mosquitto/mosquitto.conf  # Конфигурация MQTT брокера
│   ├── telegraf/telegraf.conf    # Маршрутизация MQTT -> InfluxDB
│   └── grafana/
│       ├── provisioning/         # Автоматическое подключение InfluxDB и дашбордов
│       └── dashboards/
│           └── openegiz_mine.json# Преднастроенный дашборд временных рядов шихтовки
└── scripts/
    ├── build_data.py             # Генератор геоданных карьера
    ├── generate_presentation.py  # Скрипт сборки presentation.pdf
    └── smoke_test.sh             # Скрипт автоматической проверки для судьи
```

---

## Лицензия

Проект распространяется под открытой лицензией [MIT License](LICENSE).
Авторское право: (c) 2026 team-106 (`@adixssc`).
Платформа: [OpenEgiz](https://github.com/aleka07/openegiz).

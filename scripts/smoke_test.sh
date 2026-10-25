#!/usr/bin/env bash
# ==============================================================================
# OpenEgiz Digital Mine — Automated Smoke Test & Verification Script
# For Judge Environment (Ubuntu 24.04 LTS / Bash)
# ==============================================================================
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================================${NC}"
echo -e "${CYAN}   OpenEgiz Digital Mine: Запуск скрипта самопроверки (Smoke Test)   ${NC}"
echo -e "${CYAN}====================================================================${NC}"

PASS_COUNT=0
FAIL_COUNT=0

check() {
    local name="$1"
    local command="$2"
    echo -n "Проверка: $name ... "
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}[ OK ]${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}[ FAILED ]${NC}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

# 1. Проверка Docker Compose сервисов
echo -e "\n${YELLOW}1. Проверка статуса контейнеров Docker:${NC}"
check "Контейнер Eclipse Mosquitto (MQTT)" "docker compose ps mosquitto | grep -q 'Up'"
check "Контейнер InfluxDB v2" "docker compose ps influxdb | grep -q 'Up'"
check "Контейнер Telegraf" "docker compose ps telegraf | grep -q 'Up'"
check "Контейнер Eclipse Ditto (Gateway)" "docker compose ps gateway | grep -q 'Up'"
check "Контейнер Eclipse Ditto (Things)" "docker compose ps things | grep -q 'Up'"
check "Контейнер Grafana" "docker compose ps grafana | grep -q 'Up'"
check "Контейнер Mine Simulator" "docker compose ps mine-simulator | grep -q 'Up'"
check "Контейнер 3D/ГИС Visualizer" "docker compose ps visualizer | grep -q 'Up'"

# 2. Проверка сетевых эндпоинтов и портов
echo -e "\n${YELLOW}2. Проверка доступности портов и API сервисов:${NC}"
check "Grafana HTTP API (3000)" "curl -s -f http://localhost:3000/api/health"
check "InfluxDB v2 Ping (8086)" "curl -s -f http://localhost:8086/ping"
check "Mine Simulator Health (8000)" "curl -s -f http://localhost:8000/health"
check "3D WebGL Visualizer UI (8080)" "curl -s -f http://localhost:8080/ | grep -q 'OPENEGIZ'"

# 3. Проверка цифровых двойников Eclipse Ditto
echo -e "\n${YELLOW}3. Проверка сущностей в Eclipse Ditto:${NC}"
check "Ditto Things API (8080/api/2/things)" "curl -s -u ditto:ditto http://localhost:8080/api/2/things | grep -q 'mine-01'"

# 4. Проверка эндпоинтов сценариев «Что если»
echo -e "\n${YELLOW}4. Проверка сценариев «Что если» (What-If API):${NC}"
check "Сценарий 1: Авария экскаватора" "curl -s -X POST -H 'Content-Type: application/json' -d '{\"excavator_id\":\"excavator-01\"}' http://localhost:8000/api/scenario/excavator-failure | grep -q 'ok'"
check "Сценарий 2: Переключение режима шихтовки" "curl -s -X POST -H 'Content-Type: application/json' -d '{\"mode\":\"MAX_TONNAGE\"}' http://localhost:8000/api/scenario/dispatch-mode | grep -q 'ok'"
check "Сценарий 3: Гололёд на съезде карьера" "curl -s -X POST -H 'Content-Type: application/json' -d '{\"condition\":\"slippery_ice\",\"speed_factor\":0.55}' http://localhost:8000/api/scenario/road-condition | grep -q 'ok'"
check "Сброс сценариев в штатный режим" "curl -s -X POST http://localhost:8000/api/scenario/reset | grep -q 'ok'"
check "Потоковая телеметрия техники (/api/fleet)" "curl -s http://localhost:8000/api/fleet | grep -q 'truck-01'"

# 5. Проверка файлов репозитория
echo -e "\n${YELLOW}5. Проверка ключевых файлов для сдачи проекта:${NC}"
check "Файл отчёта SUBMISSION.md" "[ -f SUBMISSION.md ] && grep -q 'team-106' SUBMISSION.md"
check "Презентация presentation.pdf" "[ -f presentation.pdf ] && [ -s presentation.pdf ]"
check "Инструкция README.md" "[ -f README.md ]"
check "Лицензия LICENSE (MIT)" "[ -f LICENSE ]"

echo -e "\n${CYAN}====================================================================${NC}"
echo -e "Итог самопроверки: ${GREEN}Успешно: $PASS_COUNT${NC} | ${RED}Ошибок: $FAIL_COUNT${NC}"
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}>>> ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ! ПРОЕКТ ПОЛНОСТЬЮ ГОТОВ К СДАЧЕ И ОЦЕНКЕ. <<<${NC}"
    exit 0
else
    echo -e "${RED}>>> Внимание: есть непройденные проверки. Изучите логи выше. <<<${NC}"
    exit 1
fi

#!/bin/bash
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # 无颜色

# 打印带颜色的消息
error() { echo -e "${RED}[错误] $1${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}[信息] $1${NC}"; }
warn() { echo -e "${YELLOW}[警告] $1${NC}"; }
step() { echo -e "${CYAN}>>> $1${NC}"; }
input_prompt() { echo -e "${BLUE}? $1${NC}"; }

check_docker() {
    if ! command -v docker &> /dev/null; then
        error "Docker 未安装！请先安装 Docker: https://docs.docker.com/get-docker/"
    fi

    if ! docker info &> /dev/null; then
        error "Docker 服务未运行！请启动 Docker 服务"
    fi
}

ask_mount() {
    local name=$1
    local default_container_path=$2
    local default_host_path=$3
    
    input_prompt "是否将 $name 挂载到本地目录? [Y/n]" >&2
    read -p "> " mount_choice
    if [[ $mount_choice =~ ^[Nn]$ ]]; then
        info "$name 将保留在容器内部" >&2
        host_path=""
    else
        input_prompt "请输入本地 $name 存储目录 (默认: $default_host_path)" >&2
        read -p "> " host_path
        host_path=${host_path:-$default_host_path}
        if ! mkdir -p "$host_path"; then
            error "创建目录 $host_path 失败！请检查权限" >&2
        fi
        info "$name 将挂载到本地: $host_path" >&2
    fi
    
    echo "$host_path"
}

# 主部署函数
deploy() {
    echo -e "${GREEN}"
    echo "========================================"
    echo "  Bilibili 直播录制工具一键部署脚本 "
    echo "========================================"
    echo -e "${NC}"
    
    step "1. 检查 Docker 环境..."
    check_docker
    
    # 容器内部目录 Global Config
    config_container_path="/app/config"
    record_container_path="/app/recordings"
    db_container_path="/app/data"

    # 配置容器名称
    while true; do
        input_prompt "请输入容器名称 (默认: bilibili-recorder)"
        read -p "> " container_name
        container_name=${container_name:-"bilibili-recorder"}
        
        # 检查容器名称是否已存在
        if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
            warn "容器名称 '$container_name' 已被使用"
            input_prompt "是否删除现有容器? [y/N]"
            read -p "> " remove_choice
            if [[ $remove_choice =~ ^[Yy]$ ]]; then
                docker rm -f "$container_name" || warn "删除容器失败，请手动处理"
                break
            fi
        else
            break
        fi
    done
    
    # 配置文件路径配置
    step "2. 配置文件路径配置 (挂载到本地)..."
    input_prompt "请输入本地配置文件目录 (默认: ./config)"
    read -p "> " config_host_path
    config_host_path=${config_host_path:-"./config"}
    if ! mkdir -p "$config_host_path"; then
        error "创建目录 $config_host_path 失败！请检查权限"
    fi
    info "配置文件将挂载: 本地 $config_host_path → 容器 $config_container_path"
    
    # 录制文件路径配置
    step "3. 录制文件路径配置..."
    record_host_path=$(ask_mount "录制文件目录" "/app/recordings" "./recordings")
    
    # 数据库路径配置
    step "4. 数据库路径配置..."
    db_host_path=$(ask_mount "数据库文件目录" "/app/data" "./data")
    
    # 端口映射配置
    step "5. 配置端口映射..."
    input_prompt "是否需要暴露端口到主机? [y/N]"
    read -p "> " expose_port
    if [[ $expose_port =~ ^[Yy]$ ]]; then
        while true; do
            input_prompt "请输入容器端口 (默认: 3000)"
            read -p "> " container_port
            container_port=${container_port:-3000}
            
            if ! [[ "$container_port" =~ ^[0-9]+$ ]] || [ "$container_port" -lt 1 ] || [ "$container_port" -gt 65535 ]; then
                warn "无效的容器端口，请输入 1-65535 之间的数字"
                continue
            fi
            
            input_prompt "请输入主机端口 (默认: $container_port)"
            read -p "> " host_port
            host_port=${host_port:-$container_port}
            
            if ! [[ "$host_port" =~ ^[0-9]+$ ]] || [ "$host_port" -lt 1 ] || [ "$host_port" -gt 65535 ]; then
                warn "无效的主机端口，请输入 1-65535 之间的数字"
                continue
            fi
            
            break
        done
        
        port_mapping="-p $host_port:$container_port"
        info "端口映射: 主机 $host_port → 容器 $container_port"
    else
        port_mapping=""
        info "不暴露端口到主机"
    fi
    
    # XzQbot 适配器配置
    step "6. 配置 XzQbot 适配器..."
    input_prompt "是否启用 XzQbot 适配器? [y/N]"
    read -p "> " enable_bot
    if [[ $enable_bot =~ ^[Yy]$ ]]; then
        enable_bot="true"
        input_prompt "请输入 XzQbot 的 WebSocket 地址:"
        read -p "> " ws_url
        [ -z "$ws_url" ] && warn "未提供 WebSocket 地址，适配器将被禁用" && enable_bot="false"
    else
        enable_bot="false"
        ws_url=""
    fi
    
    # 生成配置文件
    step "7. 生成配置文件..."
    config_file="$config_host_path/.env.production"
    cat > "$config_file" <<EOF
CONFIG_VERSION="1.0.1"
FFMPEG_BIN_FOLDER="/usr/bin"
SAVE_RECORD_FOLDER="$record_container_path"
ADAPTER_XZQBOT_ENABLE=$enable_bot
ADAPTER_XZQBOT_CONFIG_WS="$ws_url"
DB_PATH="$db_container_path/main.db"
EOF
    
    chmod 600 "$config_file"

    info "配置文件已生成: $config_host_path/.env.production"
    echo -e "${YELLOW}----------------------------------------"
    cat "$config_host_path/.env.production"
    echo -e "----------------------------------------${NC}"
    
    # 准备挂载参数
    mount_params="-v $(realpath "$config_host_path"):$config_container_path"
    [ -n "$record_host_path" ] && mount_params+=" -v $(realpath "$record_host_path"):$record_container_path"
    [ -n "$db_host_path" ] && mount_params+=" -v $(realpath "$db_host_path"):$db_container_path"

    # 拉取最新镜像
    step "8. 拉取最新镜像..."
    docker pull cnxiaozhiy/bilibili-live-recorder:latest
    
    # 运行容器
    step "9. 启动容器..."
    docker run -d \
        --name "$container_name" \
        --restart=unless-stopped \
        $mount_params \
        $port_mapping \
        cnxiaozhiy/bilibili-live-recorder:latest
    
    # 显示部署结果
    step "10. 部署完成！"
    info "容器名称: $container_name"
    info "配置文件: $(realpath "$config_host_path")/.env.production"
    
    if [ -n "$record_host_path" ]; then
        info "录制文件存储: $(realpath "$record_host_path")"
    else
        info "录制文件存储: 容器内 $record_container_path"
    fi
    
    if [ -n "$db_host_path" ]; then
        info "数据库文件: $(realpath "$db_host_path")/$(basename "$db_container_path")"
    else
        info "数据库文件: 容器内 $db_container_path"
    fi
    
    if [ -n "$port_mapping" ]; then
        info "访问地址: http://localhost:$host_port"
    fi
    
    echo ""
    warn "提示: 修改配置后请重启容器: docker restart $container_name"
    info "查看日志: docker logs -f $container_name"
    info "停止容器: docker stop $container_name"
    info "删除容器: docker rm $container_name"
    info "进入容器: docker exec -it $container_name sh"
}

# 执行部署
deploy

#!/bin/bash
# Puppeteer Chrome 浏览器安装脚本（国内镜像加速）
# 使用 npmmirror 镜像加速下载

echo "正在使用国内镜像安装 Puppeteer Chrome 浏览器..."

# 设置环境变量使用国内镜像
export PUPPETEER_DOWNLOAD_HOST="https://registry.npmmirror.com/-/binary/chrome-for-testing"

# 执行安装命令
npx puppeteer browsers install chrome

echo "安装完成！"

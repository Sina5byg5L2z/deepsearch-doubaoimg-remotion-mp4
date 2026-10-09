#!/bin/bash
# 批量跑豆包插画：逐条读 prompts.txt（格式：场景ID|提示词），失败重试一次，断点续跑
# 用法: bash run-illus.sh            （在包含 prompts.txt 的目录执行）
# 提示词会自动加上「无文字」固定前后缀，见 SKILL.md
set -u

# Windows Git Bash 需要补 PATH（coreutils）；Linux/macOS 可删掉这行
export PATH="/c/Program Files/Git/usr/bin:$PATH"

STYLE_PREFIX="手绘科普插画，米白色纸张背景，黑色钢笔简笔画线条，局部淡彩（浅蓝浅黄浅粉），Q版漫画人物，构图简洁大量留白。"
STYLE_SUFFIX="画面中绝对不要出现任何文字、数字、字母。"

mkdir -p illus
while IFS='|' read -r sid prompt; do
  [ -z "$sid" ] && continue
  case "$sid" in \#*) continue;; esac
  if ls illus/${sid}_0.* >/dev/null 2>&1; then
    echo "SKIP $sid (exists)"
    continue
  fi
  echo "=== RUN $sid $(date +%H:%M:%S) ==="
  node doubao-one.mjs ./illus "$sid" "${STYLE_PREFIX}${prompt}。${STYLE_SUFFIX}"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "RETRY $sid (rc=$rc)"
    sleep 5
    node doubao-one.mjs ./illus "$sid" "${STYLE_PREFIX}${prompt}。${STYLE_SUFFIX}"
    rc=$?
  fi
  echo "=== END $sid rc=$rc ==="
done < prompts.txt
echo "ALL_ILLUS_DONE"

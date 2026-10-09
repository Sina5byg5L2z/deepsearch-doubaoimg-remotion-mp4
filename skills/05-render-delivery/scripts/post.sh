#!/bin/bash
# 渲染完成后：混音封装 + 抽帧 QA（泛化模板）
# 用法: 修改变量后 bash post.sh
set -u
export PATH="/c/Program Files/Git/usr/bin:$PATH"   # Windows Git Bash 补 coreutils；Linux/macOS 可删

OUT=out
FINAL_NAME="final.mp4"

# 1. 封装：muted 无声视频 + 混音音轨 -> 成片
ffmpeg -y -loglevel error -i "$OUT/film-muted.mp4" -i "$OUT/mix_full.wav" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "$OUT/$FINAL_NAME"
echo "MUX_DONE"

# 2. 封装后必须核对总时长（-shortest 会悄悄截断，必须 ffprobe 验证）
echo -n "FINAL_DURATION="
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$FINAL_NAME" 2>/dev/null

# 3. 抽帧 QA：覆盖每个场景中段 + 字幕密集段（qa_times.txt 每行一个秒数）
mkdir -p qa
rm -f qa/f_*.jpg
while IFS= read -r t; do
  [ -z "$t" ] && continue
  ffmpeg -y -loglevel error -ss "$t" -i "$OUT/$FINAL_NAME" -frames:v 1 -q:v 3 "qa/f_$t.jpg"
done < qa_times.txt
echo "EXTRACT_DONE"
ls qa

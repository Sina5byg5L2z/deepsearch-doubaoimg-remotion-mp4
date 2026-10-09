#!/bin/bash
# 收尾链示例（实战项目 RADWIMPS 专题的真实链条，泛化为模板）：
# 分段补渲 -> 拼接 -> 封装 -> QA 抽帧 -> 封面，全链条带看门狗自动推进
# 用法: 修改开头的 WORKSPACE / FILM / OUT 变量后 bash finish-chain.sh
set -u

export PATH="/c/Program Files/Git/usr/bin:$PATH"   # Windows Git Bash 补 coreutils；Linux/macOS 可删
export TEMP="D:/remotion-tmp"                       # 持久临时目录，防 stitch 临时文件被清
export TMP="D:/remotion-tmp"

WORKSPACE=/path/to/node/workspace   # Remotion 工程的父目录（remotion.config.js 必须在其根）
FILM=film                           # Remotion 工程目录名
OUT=$FILM/out
cd "$WORKSPACE" || exit 1
mkdir -p "$OUT"

# 看门狗：渲染完成标记出现后自动 kill 挂起的 node（本机 Remotion 渲完不退出）
rend() {
  local tag="$1" marker="$2" logf="$3"; shift 3
  "$@" > "$logf" 2>&1 &
  local np=$!
  ( for i in $(seq 1 720); do grep -qE "$marker" "$logf" 2>/dev/null && break; sleep 5; done; sleep 8; kill -9 $np 2>/dev/null ) &
  local wd=$!
  wait $np
  if grep -qE "$marker" "$logf" 2>/dev/null; then
    echo "${tag}_EXIT=0"
  else
    echo "${tag}_EXIT=FAIL"
  fi
  kill $wd 2>/dev/null
}

# 1. 渲染（示例：补渲结尾分段。--muted 出无声视频，音轨由 post.sh 混入）
# 注意完成标记：日志行首带 ANSI 转义符，正则不能 ^ 锚定；用 ○ 行 + 文件名精确匹配
rend RENDER_S31 "○.*fix-s31\.mp4" "$OUT/render-s31.log" \
  node node_modules/@remotion/cli/remotion-cli.js render $FILM/src/index.js Film "$OUT/fix-s31.mp4" \
  --frames=30838-31190 --concurrency=10 --x264-preset=faster --muted

# 2. 拼接：主片 trim 到补渲点 + 尾段，双输入 filter_complex 重编码
ffmpeg -y -loglevel error -i "$OUT/film-muted.mp4" -i "$OUT/fix-s31.mp4" \
  -filter_complex "[0:v]trim=end_frame=30838,setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -c:v libx264 -preset faster -crf 18 -pix_fmt yuv420p -an "$OUT/film-muted-v2.mp4" 2> "$OUT/splice.log"
echo "SPLICE_EXIT=$?"
echo -n "SPLICE_DURATION="
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/film-muted-v2.mp4" 2>/dev/null

# 3. 封装音轨 + QA 抽帧
if [ -f "$OUT/film-muted-v2.mp4" ]; then
  mv -f "$OUT/film-muted-v2.mp4" "$OUT/film-muted.mp4"
  bash $FILM/post.sh > "$OUT/post.log" 2>&1
  echo "POST_EXIT=$?"
  echo -n "FINAL_DURATION="
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/final.mp4" 2>/dev/null
else
  echo "POST_EXIT=SKIP_NO_V2"
fi

# 4. 封面
rend COVER "○.*cover\.png" "$OUT/cover.log" \
  node node_modules/@remotion/cli/remotion-cli.js still $FILM/src/index.js Cover "$OUT/cover.png" --frame=90

echo "ALL_DONE"

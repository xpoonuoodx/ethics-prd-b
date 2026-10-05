#!/usr/bin/env bash
# build image ของ backend แล้ว export เป็นไฟล์ .tar (ทำเฉพาะฝั่งเครื่องตัวเอง ยังไม่ส่งขึ้น VM)
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="ethics-deploy-backend"
TAG="$(date +%Y-%m-%d-%H%M)"
OUT="ethics-backend.tar"

docker build -t "$IMAGE:latest" -t "$IMAGE:$TAG" .
docker save -o "$OUT" "$IMAGE:latest"

echo "เสร็จแล้ว: $OUT ($(du -h "$OUT" | cut -f1)) tag สำรอง: $IMAGE:$TAG"

# 公开部署用：只构建静态展示站（首页 + 数据检索），不包含本地工作台
FROM node:22-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web/ ./web/
ENV VITE_CONSOLE=off
RUN cd web && npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80

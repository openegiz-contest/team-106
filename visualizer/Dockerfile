FROM nginx:alpine

COPY visualizer/nginx.conf /etc/nginx/conf.d/default.conf

# Copy web assets
COPY visualizer/index.html /usr/share/nginx/html/
COPY visualizer/app.js /usr/share/nginx/html/
COPY visualizer/style.css /usr/share/nginx/html/

# Copy geojson data so it's accessible directly by client
COPY data/ /usr/share/nginx/html/data/

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

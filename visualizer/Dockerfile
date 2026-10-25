FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy web assets
COPY index.html /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/

# Copy geojson data so it's accessible directly by client
COPY ../data /usr/share/nginx/html/data/

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

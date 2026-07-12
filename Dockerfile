FROM nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa
COPY site /usr/share/nginx/html
COPY LICENSE THIRD_PARTY_NOTICES.md /usr/share/licenses/open-water/

# Docker

Build the image from the repository root:

```sh
docker build -t node-subway .
```

Run the proxy by publishing its default port and passing Subway options after the image name:

```sh
docker run --rm -p 3000:3000 node-subway \
  --target http://host.docker.internal:8080 \
  --log
```

On Docker Desktop, `host.docker.internal` resolves to the host machine. Use a container name instead when the target runs on the same Docker network:

```sh
docker network create subway-network
docker run --rm --network subway-network -p 3000:3000 node-subway \
  --target http://target-container:8080
```

To use a hook module, mount it into `/app` and pass its container path:

```sh
docker run --rm -p 3000:3000 \
  --mount type=bind,src="$(pwd)/examples/hooks/index.js",dst=/app/hook.js,readonly \
  node-subway \
  --target http://host.docker.internal:8080 \
  --hooks ./hook.js
```

To use a config file, mount it and any referenced hooks together. Relative hook paths are resolved from the config file's directory:

```sh
docker run --rm -p 3000:3000 \
  --mount type=bind,src="$(pwd)",dst=/config,readonly \
  node-subway --config /config/subway.json
```

The image uses `subway` as its entry point, exposes port `3000`, and accepts the same options described in the main README. If `--port` is changed, publish that container port instead:

```sh
docker run --rm -p 8081:8081 node-subway \
  --target http://host.docker.internal:8080 \
  --port 8081
```
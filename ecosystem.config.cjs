module.exports = {
  apps: [
    {
      name: "mcp-file-server",
      script: "build/index.js",
      env: {
        NODE_ENV: "production",
        AUTH_TOKEN: "fc1b04482af317cffe336de649d1988759001da0e9a01c459319cd832992e44f",
        WORKSPACE_ROOT: "D:\\PROGRAMMING FILES\\CSE2\\mcp-file-server\\workspace",
      },
      max_restarts: 10,
    },
  ],
};
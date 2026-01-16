---
name: nodejs-code-review
description: Reviews existing Node.js code to identify bugs, security issues, performance problems, and deviations from Node.js best practices.
---

# Node.js Code Review & Best Practices Skill

This skill analyzes written Node.js codebases (API, backend services, scripts) to detect bugs, architectural issues, and best-practice violations.

## When to use this skill

- When reviewing an existing Node.js backend or API
- When debugging unexpected runtime behavior
- Before production deployment
- When refactoring legacy Node.js code
- When assessing code quality for scalability and maintainability

## How to use this skill

### 1. Code Understanding
- Identify the project type (Express, Fastify, NestJS, plain Node.js)
- Detect Node.js version compatibility issues
- Understand entry points, module structure, and runtime flow

### 2. Bug & Error Detection
- Check for unhandled promise rejections
- Identify missing `await` usage
- Detect synchronous blocking operations
- Look for incorrect async patterns
- Validate error handling (`try/catch`, middleware, global handlers)

### 3. Best Practice Evaluation
- Validate folder and module structure
- Check separation of concerns (routes, services, controllers)
- Review environment variable usage (`process.env`)
- Verify logging strategy
- Evaluate dependency usage and anti-patterns

### 4. Security Review
- Identify injection risks (SQL, NoSQL, command injection)
- Check authentication and authorization logic
- Validate input sanitization and validation
- Review secret management and hardcoded credentials
- Evaluate CORS and HTTP security headers (if applicable)

### 5. Performance & Scalability
- Detect memory leaks or excessive object retention
- Review database query patterns
- Identify unnecessary synchronous operations
- Check for inefficient loops or blocking I/O

### 6. Reporting Output
Always provide:
- A clear list of detected issues
- Severity level (Critical / Warning / Improvement)
- Explanation of why it is a problem
- Suggested fix or refactor example (Node.js style)
- Optional architectural improvement suggestions

Use concise, technical language.
Avoid rewriting the entire code unless explicitly requested.

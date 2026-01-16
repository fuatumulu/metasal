---
name: srp-refactor
description: Analyzes existing code to detect Single Responsibility Principle (SRP) violations and proposes a refactoring strategy that isolates reasons to change into dedicated components.
---

# SRP Refactor Skill

This skill analyzes existing code with a strict focus on the **Single Responsibility Principle (SRP)**.

SRP is evaluated **not by code length**, but by identifying **how many independent reasons a function or module may change** over time.

The goal of this skill is to transform “god functions” into **orchestrator-style flows** composed of small, responsibility-isolated components.

## When to use this skill

- When a function or module keeps growing over time
- When small changes frequently break unrelated behavior
- When fixing one bug introduces another
- When multiple concerns are mixed in a single function
- When working with bots, automation, scrapers, or fragile external systems
- When long-term maintainability matters more than short-term speed

## Core Mental Model

For every function or module, the skill asks:

> “How many independent reasons does this code have to change?”

If the answer is more than one, an SRP violation exists.

## How to use this skill

### 1. Responsibility & Change-Reason Analysis

Analyze the code and explicitly identify:
- All **distinct responsibilities** inside the same function or module
- All **external forces** that could require a change:
  - Third-party UI changes
  - API contract changes
  - Infrastructure or environment changes
  - Business rule changes
  - Reporting or logging changes

Each distinct force is treated as a **separate reason to change**.

### 2. God Function Detection

Identify functions or modules that:
- Combine orchestration and execution logic
- Mix infrastructure concerns with business logic
- Handle lifecycle management and domain logic together
- Contain multiple try/catch blocks for unrelated concerns
- Act as a “Swiss Army knife” rather than a coordinator

These are treated as **SRP violations by design**, even if they are short or “clean-looking”.

### 3. Orchestrator Extraction Strategy

Refactor strategy follows this rule:

- The top-level function becomes an **orchestrator**
- It describes **what happens**, not **how it happens**
- It delegates work to specialized components

The orchestrator:
- Has minimal internal logic
- Contains no technical details
- Is readable as a high-level process description

### 4. Responsibility Isolation

For each identified responsibility, propose:
- A dedicated component, service, or module
- A clearly defined ownership boundary

Each isolated unit must:
- Have **exactly one reason to change**
- Be modifiable without touching other responsibilities
- Be understandable in isolation

The skill explicitly defines:
- What the component does
- What it must never be responsible for

### 5. Dependency Direction Rules

Refactoring must follow strict dependency rules:
- Orchestrators depend on specialists
- Specialists never depend on orchestrators
- Cross-responsibility coupling is forbidden
- Shared state is minimized and explicit

### 6. Error & Cleanup Separation

Error handling and cleanup logic are treated as **first-class responsibilities**:
- Error handling must not leak domain logic
- Cleanup must not depend on execution success
- Resource lifecycle is isolated from business flow

### 7. Reporting & Output Format

Always produce a structured refactoring report with:

#### A. SRP Violation Summary
- Which function/module violates SRP
- How many distinct reasons to change were identified
- Why this creates risk

#### B. Responsibility Map
- List of extracted responsibilities
- Short description of each responsibility’s scope

#### C. Proposed Orchestrator Shape
- Pseudocode or high-level flow of the new orchestrator
- Focus on readability and intent, not implementation details

#### D. Refactoring Boundaries
- What code moves where
- What must remain untouched
- What dependencies are allowed

#### E. Practical Benefits
- What future changes become safer
- What classes of bugs are eliminated
- Why maintenance cost is reduced

### 8. Output Rules

- Do not fully rewrite the code unless explicitly requested
- Prefer conceptual clarity over syntactic precision
- Do not introduce unnecessary abstractions
- Avoid framework-specific bias unless unavoidable
- Refactor for **change isolation**, not aesthetics

## Reviewer Mindset

Act as a senior engineer performing a long-term maintainability refactor.

Assume:
- The system will evolve
- External dependencies will break
- The code will be touched by multiple developers

Optimize for:
- Isolation
- Safety
- Predictability
- Repairability
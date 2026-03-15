"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";

interface Project {
  id: string;
  createdAt: string;
}

function normalizeProjectId(raw: string): string {
  return raw.trim();
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectId, setNewProjectId] = useState("");

  useEffect(() => {
    const savedProjects = localStorage.getItem("guerrilla-studio-projects");
    if (savedProjects) {
      try {
        const parsed = JSON.parse(savedProjects) as unknown[];
        const normalized: Project[] = [];
        for (const item of parsed) {
          if (item && typeof item === "object") {
            const o = item as { id?: string; name?: string; createdAt?: string };
            const id =
              typeof o.id === "string" && o.id
                ? o.id
                : typeof o.name === "string" && o.name
                  ? o.name
                  : "";
            if (id) {
              normalized.push({
                id,
                createdAt:
                  typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
              });
            }
          }
        }
        setProjects(normalized);
      } catch {
        setProjects([]);
      }
    }
  }, []);

  const createProject = () => {
    const id = normalizeProjectId(newProjectId);
    if (!id) return;
    if (projects.some((p) => p.id === id)) {
      alert("A project with this id already exists.");
      return;
    }
    const newProject: Project = {
      id,
      createdAt: new Date().toISOString(),
    };
    const updatedProjects = [...projects, newProject];
    setProjects(updatedProjects);
    localStorage.setItem("guerrilla-studio-projects", JSON.stringify(updatedProjects));
    setNewProjectId("");
  };

  const deleteProject = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const updatedProjects = projects.filter((p) => p.id !== projectId);
    setProjects(updatedProjects);
    localStorage.setItem("guerrilla-studio-projects", JSON.stringify(updatedProjects));
  };

  const panelsHref = (projectId: string) =>
    `/panels/${encodeURIComponent(projectId)}`;

  return (
    <div className="min-h-screen bg-background text-foreground flex-col">
      <TopBar title="Projects" projectId="__projects_list__" />
      <div className="flex-1 overflow-auto">
        <div className="relative mx-auto max-w-6xl px-6 py-20 sm:px-10 lg:px-16">
          <header className="mb-24 flex items-center justify-between flex-wrap gap-4">
            <span className="font-mono text-sm uppercase tracking-[0.2em] text-foreground/60">
              Projects
            </span>
            <div className="flex items-center gap-4">
              <input
                type="text"
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createProject();
                }}
                placeholder="Project id…"
                className="rounded-lg border border-foreground/20 bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-transparent min-w-[12rem]"
              />
              <button
                type="button"
                onClick={createProject}
                disabled={!normalizeProjectId(newProjectId)}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-semibold text-background transition hover:bg-accent-muted disabled:opacity-50 disabled:cursor-not-allowed"
              >
                New Project
              </button>
            </div>
          </header>

          <main className="pt-12">
            {projects.length === 0 ? (
              <div className="text-center py-20">
                <h2 className="font-sans text-2xl font-semibold text-foreground mb-4">
                  No projects yet
                </h2>
                <p className="max-w-xl text-lg text-foreground/75">
                  Create a project with a unique id to open Guerrilla Studio panels for that project.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    href={panelsHref(project.id)}
                    className="group relative block rounded-lg border border-foreground/10 bg-background/50 p-6 transition-all hover:border-accent/30 hover:bg-accent/5 cursor-pointer no-underline text-inherit"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="font-sans text-lg font-semibold text-foreground group-hover:text-accent transition-colors font-mono break-all">
                        {project.id}
                      </h3>
                      <button
                        type="button"
                        onClick={(e) => deleteProject(e, project.id)}
                        className="text-foreground/40 hover:text-foreground/60 transition-colors shrink-0 ml-2"
                        title="Delete project"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>
                    </div>

                    <p className="font-mono text-xs text-foreground/40">
                      Created:{" "}
                      {new Date(project.createdAt).toLocaleDateString()}
                    </p>

                    <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-background transition group-hover:bg-accent-muted pointer-events-none">
                      Open panels
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 18l6-6-6 6" />
                        <path d="M21 12h-12" />
                      </svg>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

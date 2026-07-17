export function buildProjectById(projects) {
  return new Map(projects.map((project) => [project.id, project]));
}

export function buildProjectLastImportAt(projects) {
  const childrenByParent = new Map();

  for (const project of projects) {
    const key = project.parent_id || "root";
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(project);
  }

  const memo = new Map();

  const newest = (project) => {
    if (!project) return "";
    if (memo.has(project.id)) return memo.get(project.id);

    let best = project.last_import_at || "";
    for (const child of childrenByParent.get(project.id) || []) {
      const childTime = newest(child);
      if (childTime && (!best || new Date(childTime).getTime() > new Date(best).getTime())) best = childTime;
    }

    memo.set(project.id, best);
    return best;
  };

  for (const project of projects) newest(project);
  return memo;
}

export function buildProjectBreadcrumbs(project, projectById, limit) {
  const rows = [];
  let cursor = project;
  const seen = new Set();

  while (cursor && !seen.has(cursor.id) && rows.length < limit) {
    rows.unshift(cursor);
    seen.add(cursor.id);
    cursor = cursor.parent_id ? projectById.get(cursor.parent_id) : null;
  }

  return rows;
}

export function buildHomeStats(currentFolder, projects, trashProjects) {
  return {
    title: currentFolder?.name || "全部项目",
    projects: currentFolder ? 1 : projects.filter((project) => !project.parent_id).length,
    folders: currentFolder ? Number(currentFolder.child_count || 0) : projects.length,
    images: currentFolder
      ? Number(currentFolder.image_count || 0)
      : projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.image_count || 0), 0),
    videos: currentFolder
      ? Number(currentFolder.video_count || 0)
      : projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.video_count || 0), 0),
    annotations: currentFolder
      ? Number(currentFolder.annotation_count || 0)
      : projects.reduce((sum, project) => sum + Number(project.parent_id ? 0 : project.annotation_count || 0), 0),
    trash: trashProjects.length,
  };
}

export function getCreateProjectContext({
  view,
  activeProject,
  activeBreadcrumbs,
  breadcrumbs,
  currentFolderId,
}) {
  const isWorkspace = view === "workspace" && activeProject;

  return {
    depth: isWorkspace ? activeBreadcrumbs.length : breadcrumbs.length,
    isWorkspace,
    parentId: isWorkspace ? activeProject.id : currentFolderId,
  };
}

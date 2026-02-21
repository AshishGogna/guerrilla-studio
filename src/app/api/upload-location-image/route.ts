import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const projectId = formData.get('projectId') as string;

    if (!image || !projectId) {
      return NextResponse.json(
        { error: 'Missing image or projectId' },
        { status: 400 }
      );
    }

    // Create project directory if it doesn't exist
    const projectDir = join(process.cwd(), 'public', projectId);
    try {
      await mkdir(projectDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `location-${timestamp}.png`;
    const filepath = join(projectDir, filename);

    // Convert File to buffer and save
    const bytes = await image.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filepath, buffer);

    // Return the public path
    const publicPath = `/${projectId}/${filename}`;
    
    return NextResponse.json({
      success: true,
      filePath: publicPath
    });

  } catch (error) {
    console.error('Error uploading location image:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}

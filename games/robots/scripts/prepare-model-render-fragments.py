"""Review the actual saved destruction NLA scene, independently of runtime snapshots."""
import bpy, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 1000
scene.render.resolution_y = 700
scene.render.resolution_percentage = 100
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get('Background')
if background:
    background.inputs[0].default_value = (.06, .09, .13, 1)
    background.inputs[1].default_value = .35

def area(name, location, energy, color, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.color, data.size = energy, color, size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, .5)) - obj.location).to_track_quat('-Z', 'Y').to_euler()

area('Review_Key', (3, -4, 6), 1100, (1, .85, .65), 5)
area('Review_Fill', (-4, 0, 4), 800, (.4, .65, 1), 5)
bpy.ops.mesh.primitive_plane_add(size=100, location=(0, 0, -.025))
floor = bpy.context.object
material = bpy.data.materials.new('Review_Floor')
material.diffuse_color = (.024, .03, .042, 1)
floor.data.materials.append(material)
data = bpy.data.cameras.new('Review_Camera')
camera = bpy.data.objects.new('Review_Camera', data)
bpy.context.collection.objects.link(camera)
camera.location = (5, -7, 6)
camera.rotation_euler = (Vector((0, 0, .2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
data.type, data.ortho_scale = 'ORTHO', 10
scene.camera = camera
scene.frame_set(121)
scene.render.filepath = os.path.join(ROOT, 'assets-source', 'pose-review', 'v5-source-wreck.png')
bpy.ops.render.render(write_still=True)

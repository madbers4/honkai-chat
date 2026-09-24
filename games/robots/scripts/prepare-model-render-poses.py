import bpy, os, sys
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets-source','pose-review');os.makedirs(OUT,exist_ok=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=720;scene.render.resolution_y=720;scene.render.resolution_percentage=100
world=scene.world;world.use_nodes=True;world.node_tree.nodes.clear()
bg=world.node_tree.nodes.new('ShaderNodeBackground');bg.inputs[0].default_value=(.1,.14,.2,1);bg.inputs[1].default_value=.4
out=world.node_tree.nodes.new('ShaderNodeOutputWorld');world.node_tree.links.new(bg.outputs[0],out.inputs[0])
def light(name,loc,energy,color,size):
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.color=color;d.size=size
 o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1.1))-o.location).to_track_quat('-Z','Y').to_euler()
light('Key',(3,-4,5),700,(1,.84,.63),4);light('Fill',(-4,-1,3),600,(.4,.7,1),4);light('Rim',(1,4,5),950,(.4,.8,1),3)
bpy.ops.mesh.primitive_plane_add(size=100,location=(0,0,-.025));floor=bpy.context.object
material=bpy.data.materials.new('Review_Floor');material.diffuse_color=(.016,.025,.04,1);floor.data.materials.append(material)
d=bpy.data.cameras.new('Review_Camera');camera=bpy.data.objects.new('Review_Camera',d);bpy.context.collection.objects.link(camera)
camera.location=(3,-6,3.2);camera.rotation_euler=(Vector((0,0,1.0))-camera.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=4.8;scene.camera=camera
arm=bpy.data.objects['Automaton_Rig']
v4='--v4' in sys.argv
v5='--v5' in sys.argv
poses=[('Jab',5),('Cross',7),('Rake',10),('Crusher',13),('Airfinish',8),('Recover',28),('Defeatedcorerip',54),('Grabpummel1',5),('Grabpummel2',5)] if v5 else [('Idle',1),('Idledamaged',31),('Idlecritical',116),('Walkcritical',13),('Guardbreak',7),('Burstrepelled',3),('Parried',4),('Healthrecovery',50)] if v4 else [('Heavy',8),('Walk',7),('Ko',48),('Block',20),('Dashstrike',6),('Launcher',10),('Slam',17),('Shockwave',12),('Overload',41)]
for name,frame in poses:
 arm.animation_data.action=bpy.data.actions['Combat_'+name];scene.frame_set(frame)
 scene.render.filepath=os.path.join(OUT,('v5-source-' if v5 else 'v4-' if v4 else '')+name.lower()+'.png');bpy.ops.render.render(write_still=True)
print('Rendered',len(poses),'native baked animation poses to',OUT)
